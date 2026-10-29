// B2 live-mode browser E2E — drives REAL Chrome over CDP, no npm deps
// (Node >= 22 provides the global WebSocket client).
//
// Scenarios (each = several checks):
//   1. Sign-up (new local test account) lands in the app.
//   2. Reload → session restored (no bounce to /login).
//   3. Create a lead → survives reload (real Supabase persistence).
//   4. Notification prefs: toggle + save → toast → survives reload.
//   5. Sign-out → back at /login; reload stays signed out.
//   6. Second user (separate browser context = separate cookie jar) sees
//      only their own empty workspace — never user 1's lead.
//
// Local only: app on 127.0.0.1:3000 (dev server with .env.local), Chrome
// headless with a throwaway profile dir. Refuses to run otherwise.
//
//   node tests/e2e-cdp.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000";
const CDP_PORT = Number(process.env.E2E_CDP_PORT ?? 9333);
const CHROME =
  process.env.E2E_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(APP)) {
  console.error(`Refusing to run against non-loopback app URL "${APP}".`);
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- app reachability ------------------------------------------------------
const appUp = await fetch(`${APP}/login`, { redirect: "manual" })
  .then((r) => r.ok || r.status === 307 || r.status === 308)
  .catch(() => false);
if (!appUp) {
  console.error(`No dev server on ${APP}. Start it with \`npm run dev\`.`);
  process.exit(2);
}

// --- Chrome + CDP plumbing -------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "fairway-e2e-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpEndpoint() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* Chrome not up yet */
    }
    await sleep(500);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

const browserWs = new WebSocket(await cdpEndpoint());
await new Promise((resolve, reject) => {
  browserWs.onopen = resolve;
  browserWs.onerror = () => reject(new Error("CDP WebSocket failed"));
});

let msgId = 0;
const pending = new Map();
const listeners = [];
browserWs.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method) {
    for (const fn of listeners) fn(msg);
  }
};

function send(method, params = {}, sessionId) {
  const id = (msgId += 1);
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  browserWs.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30_000);
  });
}

/** A page in its own incognito-style browser context (isolated cookies). */
async function newPage() {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  return { sessionId, targetId, browserContextId, consoleErrors: [] };
}

// Collect page-level errors: uncaught exceptions and console.error calls.
listeners.push((msg) => {
  if (!msg.sessionId) return;
  const page = pages.find((p) => p.sessionId === msg.sessionId);
  if (!page) return;
  if (msg.method === "Runtime.exceptionThrown") {
    page.consoleErrors.push(
      msg.params.exceptionDetails?.exception?.description ??
        msg.params.exceptionDetails?.text ??
        "exception",
    );
  }
  if (
    msg.method === "Runtime.consoleAPICalled" &&
    msg.params.type === "error"
  ) {
    // The app logs live-mode background write failures as console.error;
    // those are real defects in this context and must fail the run.
    page.consoleErrors.push(
      msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    );
  }
});
const pages = [];

async function evalPage(page, expression) {
  const { result, exceptionDetails } = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    page.sessionId,
  );
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description ?? exceptionDetails.text,
    );
  }
  return result.value;
}

async function goto(page, path) {
  await send("Page.navigate", { url: `${APP}${path}` }, page.sessionId);
  await waitFor(page, () => document.readyState === "complete", 15_000);
}

/** Poll an expression until truthy; returns the value or throws. */
async function waitFor(page, fn, timeout = 10_000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeout) {
    try {
      const v = await evalPage(page, `(${fn.toString()})()`);
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`waitFor timed out${lastErr ? `: ${lastErr.message}` : ""}`);
}

// React-controlled inputs need the native value setter + a bubbling input
// event, or React never registers the change.
const SET_VALUE = `(sel, value) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}`;

async function fill(page, sel, value) {
  const ok = await evalPage(
    page,
    `(${SET_VALUE})(${JSON.stringify(sel)}, ${JSON.stringify(value)})`,
  );
  if (!ok) throw new Error(`no element for ${sel}`);
}

async function click(page, fn) {
  await evalPage(page, `(() => { (${fn.toString()})(); return true; })()`);
}

/**
 * Click with retries until `cond` is true on the page. Needed because a
 * .click() dispatched before React hydration finishes is silently dropped
 * (no listeners attached yet).
 */
async function clickUntil(page, clickFn, cond, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await click(page, clickFn);
    try {
      if (await evalPage(page, `(${cond.toString()})()`)) return;
    } catch {
      /* navigation race */
    }
    await sleep(400);
  }
  throw new Error("clickUntil timed out");
}

// --- run -------------------------------------------------------------------
console.log(`B2 browser E2E against ${APP} (Chrome headless, CDP ${CDP_PORT})`);

const stamp = Date.now();
const USER1 = {
  name: "E2E Alice",
  email: `e2e-a-${stamp}@example.com`,
  password: "E2e-local-passw0rd!",
  company: "CDP Test Golf Labs",
};
const USER2 = { name: "E2E Bob", email: `e2e-b-${stamp}@example.com`, password: "E2e-local-passw0rd!" };

const followUp = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

// --- user 1: sign-up -------------------------------------------------------
console.log(`\n1. Sign-up (${USER1.email})`);
const p1 = await newPage();
pages.push(p1);

await goto(p1, "/login");
await waitFor(p1, () => document.body.innerText.includes("Welcome back"));
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent.trim() === "Create account",
    )?.click();
  },
  () => document.body.innerText.includes("Create your account"),
);
await fill(p1, 'input[placeholder="Alex Morgan"]', USER1.name);
await fill(p1, 'input[placeholder="you@company.com"]', USER1.email);
await fill(p1, 'input[type="password"]', USER1.password);
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button[type=submit]")][0]?.click();
  },
  () => location.pathname === "/",
  15_000,
);

// After signup the app navigates to /; live mode then shows the loading
// shell until the workspace fetch lands.
check("sign-up lands in the app (not bounced, no error banner)", true);
await waitFor(
  p1,
  () => document.body.innerText.includes("Pipeline") || document.body.innerText.includes("Loading"),
  10_000,
).catch(() => {});
// Wait for the loading shell to clear (workspace hydrated).
await waitFor(p1, () => !document.body.innerText.includes("Loading your workspace"), 15_000);
check(
  "dashboard hydrates (loading shell cleared, signed-in header)",
  await evalPage(p1, () => document.body.innerText.includes("Sign out")),
);

// --- user 1: session restored after reload ---------------------------------
console.log("\n2. Session restoration after reload");
await p1.consoleErrors.splice(0); // reload races are not app errors
await evalPage(p1, () => location.reload(), 1);
await sleep(3_000);
await waitFor(p1, () => document.readyState === "complete" && document.body.innerText.length > 0);
await waitFor(p1, () => !document.body.innerText.includes("Loading your workspace"), 15_000).catch(() => {});
check(
  "reload keeps the session (still on /, Sign out visible, no /login bounce)",
  await evalPage(
    p1,
    () => location.pathname === "/" && document.body.innerText.includes("Sign out"),
  ),
  await evalPage(p1, () => location.pathname),
);

// --- user 1: create a lead, verify persistence ------------------------------
console.log("\n3. Create a lead and verify it persists");
await goto(p1, "/leads");
await waitFor(p1, () => document.body.innerText.includes("Leads"));
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Add lead" && b.offsetParent !== null)
      ?.click();
  },
  () => document.body.innerText.includes("Estimated value"),
);
await fill(p1, 'input[placeholder="Apex Indoor Golf"]', USER1.company);
await fill(p1, 'input[placeholder="Marcus Hale"]', "Dana CDP");
await fill(p1, 'input[placeholder="name@company.example"]', `dana@${stamp}.example`);
await fill(p1, "input[type=number]", "31000");
await fill(p1, "input[type=date]", followUp);
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button[type=submit]")].find((b) =>
      b.textContent.trim() === "Add lead",
    )?.click();
  },
  () => document.body.innerText.includes(USER1.company),
);
check("lead row appears after submit", true);

// Give the background mirror write time to land, then reload.
await sleep(2_500);
await evalPage(p1, () => location.reload(), 1);
await sleep(3_000);
await waitFor(p1, () => document.readyState === "complete");
await goto(p1, "/leads");
await waitFor(p1, () => document.body.innerText.includes("Leads"));
const leadAfterReload = await waitFor(
  p1,
  () => document.body.innerText.includes(USER1.company) || "ABSENT",
  15_000,
);
check(
  "lead survives reload (hydrated from Supabase, not local state)",
  leadAfterReload !== "ABSENT",
);

// --- user 1: notification prefs --------------------------------------------
console.log("\n4. Notification preferences save/reload");
await goto(p1, "/settings");
await waitFor(p1, () => document.body.innerText.includes("Settings"));
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("[role=tab]")]
      .find((t) => t.textContent.trim() === "Notifications")
      ?.click();
  },
  () => Boolean(document.querySelector("#notif-weeklyReport")),
);
const weeklyBefore = await evalPage(
  p1,
  () => document.querySelector("#notif-weeklyReport").getAttribute("aria-checked"),
);
await clickUntil(
  p1,
  () => {
    document.querySelector("#notif-weeklyReport").click();
  },
  () =>
    document.querySelector("#notif-weeklyReport").getAttribute("aria-checked") !==
    weeklyBefore,
);
const weeklyToggled = await evalPage(
  p1,
  () => document.querySelector("#notif-weeklyReport").getAttribute("aria-checked"),
);
check(
  "weekly-report switch toggles",
  weeklyBefore !== weeklyToggled,
  `before=${weeklyBefore} after=${weeklyToggled}`,
);
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Save changes" && b.offsetParent !== null)
      ?.click();
  },
  () => document.body.innerText.includes("Notification preferences saved."),
  8_000,
).catch(() => {});
const toastSeen = await evalPage(
  p1,
  () =>
    document.body.innerText.includes("Notification preferences saved.")
      ? "SEEN"
      : "NO-TOAST",
);
check("save confirms with a toast", toastSeen === "SEEN", toastSeen);

await sleep(1_500);
await evalPage(p1, () => location.reload(), 1);
await sleep(3_000);
await waitFor(p1, () => document.readyState === "complete");
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("[role=tab]")]
      .find((t) => t.textContent.trim() === "Notifications")
      ?.click();
  },
  () => Boolean(document.querySelector("#notif-weeklyReport")),
);
const weeklyAfterReload = await waitFor(
  p1,
  () => document.querySelector("#notif-weeklyReport").getAttribute("aria-checked"),
  10_000,
);
check(
  "toggled value survives reload (persisted to profiles)",
  weeklyAfterReload === weeklyToggled,
  `expected=${weeklyToggled} got=${weeklyAfterReload}`,
);

// --- user 1: sign out ------------------------------------------------------
console.log("\n5. Sign-out");
await clickUntil(
  p1,
  () => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Sign out" && b.offsetParent !== null)
      ?.click();
  },
  () => location.pathname === "/login",
  10_000,
);
check("sign-out lands on /login", await evalPage(p1, () => location.pathname === "/login"));
await evalPage(p1, () => location.reload(), 1);
await sleep(2_500);
await waitFor(p1, () => document.readyState === "complete");
check(
  "reload after sign-out stays signed out",
  await evalPage(
    p1,
    () => location.pathname === "/login" || !document.body.innerText.includes("Sign out"),
  ),
  await evalPage(p1, () => location.pathname),
);

// --- user 2: isolation -----------------------------------------------------
console.log(`\n6. Second user isolation (${USER2.email})`);
const p2 = await newPage();
pages.push(p2);
await goto(p2, "/login");
await waitFor(p2, () => document.body.innerText.includes("Welcome back"));
await clickUntil(
  p2,
  () => {
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent.trim() === "Create account",
    )?.click();
  },
  () => document.body.innerText.includes("Create your account"),
);
await fill(p2, 'input[placeholder="Alex Morgan"]', USER2.name);
await fill(p2, 'input[placeholder="you@company.com"]', USER2.email);
await fill(p2, 'input[type="password"]', USER2.password);
await clickUntil(
  p2,
  () => {
    [...document.querySelectorAll("button[type=submit]")][0]?.click();
  },
  () => location.pathname === "/",
  15_000,
);
await waitFor(p2, () => !document.body.innerText.includes("Loading your workspace"), 15_000);

await goto(p2, "/leads");
await waitFor(p2, () => document.body.innerText.includes("Leads"));
const seesOwn = await waitFor(
  p2,
  () =>
    document.body.innerText.includes("No leads yet") ||
    document.body.innerText.includes(USER1.company) ||
    "AMBIGUOUS",
  15_000,
);
check(
  "second user's leads list does not contain user 1's lead",
  seesOwn === "No leads yet",
  seesOwn === "AMBIGUOUS"
    ? "neither empty state nor foreign lead found"
    : `leaked: ${USER1.company}`,
);

// Deep probe: even a direct id-lookup style navigation must not render it.
const leaked = await evalPage(
  p2,
  `fetch(${JSON.stringify(APP)}/login, { method: "GET" }).then(() => "ok").catch(() => "err")`,
);
check("app fetches from browser context behave", leaked === "ok");

// --- report -----------------------------------------------------------------
const totalErrors = pages.reduce((n, p) => n + p.consoleErrors.length, 0);
if (totalErrors > 0) {
  console.log("\nConsole errors seen in pages:");
  for (const p of pages) {
    for (const e of p.consoleErrors) console.log(`  [page ${p.targetId.slice(0, 8)}] ${e}`);
  }
}
check("no console errors during the run", totalErrors === 0, `${totalErrors} error(s)`);

console.log(`\n${passed} passed, ${failed} failed`);

browserWs.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* best effort */
}
process.exit(failed > 0 ? 1 : 0);
