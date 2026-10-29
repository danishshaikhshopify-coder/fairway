// B2 auth rules — pure logic shared by src/proxy.ts and the browser client.
// No DOM, no network: `node --test` runs these directly against the source.
import assert from "node:assert/strict";
import test from "node:test";
import {
  authRedirect,
  hasAuthCookie,
  isLiveMode,
  isPublicPath,
  supabaseEnv,
} from "../src/lib/supabase/auth.ts";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function withEnv(url: string | undefined, anonKey: string | undefined, run: () => void) {
  const prev = { url: process.env[URL_KEY], anonKey: process.env[KEY_KEY] };
  if (url === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = url;
  if (anonKey === undefined) delete process.env[KEY_KEY];
  else process.env[KEY_KEY] = anonKey;
  try {
    run();
  } finally {
    if (prev.url === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = prev.url;
    if (prev.anonKey === undefined) delete process.env[KEY_KEY];
    else process.env[KEY_KEY] = prev.anonKey;
  }
}

test("live mode needs BOTH env vars — one alone stays demo", () => {
  withEnv(undefined, undefined, () => {
    assert.equal(isLiveMode(), false);
    assert.equal(supabaseEnv(), null);
  });
  withEnv("http://127.0.0.1:54321", undefined, () => {
    assert.equal(isLiveMode(), false);
  });
  withEnv(undefined, "anon-key", () => {
    assert.equal(isLiveMode(), false);
  });
  withEnv("http://127.0.0.1:54321", "anon-key", () => {
    assert.equal(isLiveMode(), true);
    assert.deepEqual(supabaseEnv(), {
      url: "http://127.0.0.1:54321",
      anonKey: "anon-key",
    });
  });
});

test("detects the session cookie supabase-js actually writes", () => {
  // Default storage key for http://127.0.0.1:54321 — first hostname label only.
  assert.equal(hasAuthCookie([{ name: "sb-127-auth-token", value: "eyJhbGci" }]), true);
  // Long values are split into `.0`, `.1`, … chunks.
  assert.equal(hasAuthCookie([{ name: "sb-127-auth-token.0", value: "eyJ" }]), true);
  assert.equal(
    hasAuthCookie([
      { name: "sb-127-auth-token.0", value: "eyJ" },
      { name: "sb-127-auth-token.1", value: "ciI" },
    ]),
    true,
  );
  // Hosted projects get a different label; the shape is what matters.
  assert.equal(hasAuthCookie([{ name: "sb-abc123def-auth-token", value: "x" }]), true);
});

test("ignores lookalike and empty cookies", () => {
  assert.equal(hasAuthCookie([]), false);
  assert.equal(hasAuthCookie([{ name: "other", value: "x" }]), false);
  assert.equal(hasAuthCookie([{ name: "sb-127-auth-tokenx", value: "x" }]), false);
  assert.equal(hasAuthCookie([{ name: "sb-127-auth-token-old", value: "x" }]), false);
  // A signed-out browser can be left with a zero-length cookie; that is not a
  // session and must not open the CRM.
  assert.equal(hasAuthCookie([{ name: "sb-127-auth-token", value: "" }]), false);
});

test("only /login is public", () => {
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/login/"), true);
  assert.equal(isPublicPath("/logins"), false);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/leads"), false);
});

test("sends signed-out browsers to /login with a safe return path", () => {
  assert.equal(authRedirect("/leads", false), "/login?next=%2Fleads");
  assert.equal(authRedirect("/", false), "/login?next=%2F");
  assert.equal(authRedirect("/settings", false), "/login?next=%2Fsettings");
});

test("leaves signed-in requests alone, except on /login", () => {
  assert.equal(authRedirect("/leads", true), null);
  assert.equal(authRedirect("/", true), null);
  assert.equal(authRedirect("/login", true), "/");
  assert.equal(authRedirect("/login/", true), "/");
});

test("never gates /login for a signed-out browser", () => {
  assert.equal(authRedirect("/login", false), null);
});
