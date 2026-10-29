// B2 auth verification — runs against a LOCAL Supabase stack and, for part B,
// the local app server only.
//
// Part A drives GoTrue through the real client SDK: signup bootstrap, sign-in,
// refresh (session persistence), sign-out, a wrong password, and an
// unauthenticated read seeing nothing.
// Part B drives the app's own proxy (src/proxy.ts) over HTTP: CRM routes must
// bounce signed-out browsers to /login, /login must bounce signed-in ones home,
// and the cookie name the proxy looks for must be the one @supabase/ssr writes.
//
// RLS/tenant isolation and the wider anon-access sweep live in
// tests/b2-live-check.mjs; this script covers the auth surface only.
//
// Requires a local stack (`supabase start`) and, for part B, `npm run dev`
// with the live env from .env.local. Part B is skipped, loudly, when the app
// server is not reachable.
//
//   node tests/b2-auth-live-check.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.B2_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.B2_ANON_KEY;
const appUrl = process.env.B2_APP_URL ?? "http://127.0.0.1:3000";

if (!anonKey) {
  console.error("B2_ANON_KEY is required (from `supabase status`).");
  process.exit(2);
}
for (const [label, target] of [
  ["B2_URL", url],
  ["B2_APP_URL", appUrl],
]) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(target)) {
    console.error(`Refusing to run ${label} against non-loopback "${target}".`);
    process.exit(2);
  }
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

// One client per actor. Signing in on a client leaves the session in that
// client's memory, so the same client can then read tables as that user.
const mk = (who) =>
  createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": `b2-auth-live-check/${who}` } },
  });

const email = `auth-check-${Date.now()}@example.com`;
const password = "local-stack-pass-1";

// ---------------------------------------------------------------- part A ----
console.log(`\nA. GoTrue flows (${url})`);

const boot = mk("boot");
const signup = await boot.auth.signUp({
  email,
  password,
  options: { data: { full_name: "Auth Check" } },
});
check(
  "signup returns a session (email confirmations are off locally)",
  !signup.error && Boolean(signup.data.session),
  signup.error?.message,
);

// boot now holds that session, so these reads run as the new user.
const [{ data: profile, error: profileError }, workspace, stages, sources, ownLeads] =
  await Promise.all([
    boot.from("profiles").select("full_name").single(),
    boot.from("workspaces").select("id").limit(1),
    boot.from("pipeline_stages").select("id"),
    boot.from("lead_sources").select("id"),
    boot.from("leads").select("id"),
  ]);
check(
  "signup bootstraps a profile carrying the signup full_name",
  !profileError && profile?.full_name === "Auth Check",
  profileError?.message,
);
check(
  "signup bootstraps a workspace with 6 stages and 6 sources",
  (workspace.data?.length ?? 0) === 1 &&
    (stages.data?.length ?? 0) === 6 &&
    (sources.data?.length ?? 0) === 6,
  `workspace=${workspace.data?.length} stages=${stages.data?.length} sources=${sources.data?.length}`,
);
check(
  "the new user can read their own workspace (empty, no error)",
  !ownLeads.error && ownLeads.data.length === 0,
  ownLeads.error?.message,
);

const anon = mk("anon");
const anonLeads = await anon.from("leads").select("id");
check(
  "an unauthenticated read of leads exposes no rows",
  !(Array.isArray(anonLeads.data) && anonLeads.data.length > 0),
  JSON.stringify(anonLeads.data ?? anonLeads.error?.message),
);

check(
  "sign-in with the right password returns a fresh session",
  (await mk("signin").auth.signInWithPassword({ email, password })).error === null,
);
check(
  "sign-in with the wrong password is rejected",
  (await mk("wrong").auth.signInWithPassword({ email, password: "wrong-password" })).error !== null,
);

const signedIn = await boot.auth.signInWithPassword({ email, password });
check(
  "the session from sign-in carries both tokens",
  !signedIn.error && Boolean(signedIn.data.session?.access_token) && Boolean(signedIn.data.session?.refresh_token),
  signedIn.error?.message,
);

// Refresh is what keeps a browser signed in across the access token's short
// lifetime; drive it through the token endpoint so the result is unambiguous.
async function refreshWith(refreshToken) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

const refreshToken = signedIn.data.session.refresh_token;
const beforeSignout = await refreshWith(refreshToken);
check(
  "the refresh token grants a new session (persistence)",
  beforeSignout.ok && Boolean(beforeSignout.body?.access_token),
  `status ${beforeSignout.status}`,
);
check(
  "the refreshed access token belongs to the same user",
  beforeSignout.body?.user?.email === email,
);

const signout = await boot.auth.signOut();
check("sign-out succeeds", !signout.error, signout.error?.message);
check(
  "sign-out clears the local session",
  (await boot.auth.getSession()).data.session === null,
);

const afterSignout = await refreshWith(refreshToken);
check(
  "sign-out revokes the refresh token server-side",
  !afterSignout.ok,
  `status ${afterSignout.status}`,
);

// ---------------------------------------------------------------- part B ----
console.log(`\nB. App proxy (${appUrl})`);

async function get(path, cookie) {
  const res = await fetch(`${appUrl}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}
const isRedirect = (r) => r.status >= 300 && r.status < 400;
// Next may hand back a relative or an absolute Location for a same-origin
// redirect; both mean the same thing here.
const pointsTo = (r, path) => (r.location ?? "").endsWith(path);

const ping = await fetch(`${appUrl}/login`, { redirect: "manual" }).catch(() => null);
if (!ping) {
  console.log(`  SKIP — no app server on ${appUrl}. Start it with \`npm run dev\`.`);
} else {
  // The proxy only inspects the cookie NAME (src/lib/supabase/auth.ts); parsing
  // the value is the browser client's job and never happens in a fetch. The
  // name is @supabase/ssr's default storage key for a 127.0.0.1 host, which is
  // what proves the gate opens for a real signed-in browser.
  const cookie = "sb-127-auth-token=live-check";

  const home = await get("/");
  check(
    "signed-out request to / redirects to /login with a return path",
    isRedirect(home) && (home.location ?? "").includes("/login?next=%2F"),
    `status ${home.status} location ${home.location}`,
  );

  const leads = await get("/leads");
  check(
    "signed-out request to /leads redirects to /login?next=%2Fleads",
    isRedirect(leads) && (leads.location ?? "").includes("/login?next=%2Fleads"),
    `status ${leads.status} location ${leads.location}`,
  );

  const login = await get("/login");
  check("signed-out request to /login is served", login.status === 200, `status ${login.status}`);
  check(
    "/login renders the sign-in form",
    login.body.includes("Welcome back") && login.body.includes("Sign in"),
  );

  const loginWithCookie = await get("/login", cookie);
  check(
    "signed-in request to /login bounces to /",
    isRedirect(loginWithCookie) && pointsTo(loginWithCookie, "/"),
    `status ${loginWithCookie.status} location ${loginWithCookie.location}`,
  );

  const leadsWithCookie = await get("/leads", cookie);
  check(
    "signed-in request to /leads is served",
    leadsWithCookie.status === 200,
    `status ${leadsWithCookie.status}`,
  );

  const asset = await fetch(`${appUrl}/_next/static/nope.js`, { redirect: "manual" }).catch(() => null);
  check(
    "the proxy does not intercept static assets",
    !asset || !isRedirect({ status: asset.status }),
  );
}

// ----------------------------------------------------------------- report ----
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
