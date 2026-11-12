// Isolated verification of the INSTALLED @supabase/auth-js (v2.118.0)
// behavior for each wire format an admin-generated invite link could use.
// These construct the real GoTrueClient from node_modules — not a mock of
// our own code — with only `fetch` replaced, so every assertion here is
// evidence about the library itself. See invite-accept-ui.test.tsx for tests
// of our page code against a mocked `auth` object.
//
// Findings these encode (see PR/commit notes for full writeup):
// - This app's shared client is flowType: "pkce" (src/lib/supabase/client.ts).
//   A pkce-flowType client does not merely ignore an implicit `#access_token=`
//   callback — GoTrueClient._getSessionFromURL() explicitly rejects it
//   (AuthPKCEGrantCodeExchangeError) because the flow type doesn't match the
//   URL shape. That rejection is swallowed inside _initialize(), so
//   getSession() afterward just reports no session — reproducing exactly the
//   "missing or expired" message, for every implicit-format invite link.
// - A `?code=` callback fails for the opposite, unfixable reason: no PKCE
//   code_verifier was ever generated in the invitee's browser (the flow was
//   started by an admin's server-side call, not by this browser), so
//   exchangeCodeForSession always throws AuthPKCECodeVerifierMissingError.
//   Switching that client to flowType: "implicit" does not fix this case —
//   it removes the local guard and sends the exchange to the server anyway
//   with an empty verifier; whether that succeeds is the server's call, not
//   ours (see the two `?code=` tests below).
// - verifyOtp({ token_hash, type }) needs no verifier at all, regardless of
//   flowType, because it is a direct POST to /verify rather than a PKCE code
//   exchange. It only helps if a `token_hash` ever reaches this page, which
//   requires a custom Supabase email template (a production config change,
//   not made here) — included so the page can take advantage of that format
//   for free if the template is ever changed.
import { describe, expect, it, vi } from "vitest";
import { GoTrueClient } from "@supabase/auth-js";

const AUTH_URL = "https://project.supabase.co/auth/v1";
let keyCounter = 0;

function newClient(
  flowType: "pkce" | "implicit",
  fetchImpl: typeof fetch,
): GoTrueClient {
  return new GoTrueClient({
    url: AUTH_URL,
    storageKey: `test-key-${keyCounter++}`,
    flowType,
    fetch: fetchImpl,
    autoRefreshToken: false,
  });
}

function setLocation(hrefWithQueryOrHash: string) {
  window.history.replaceState({}, "", hrefWithQueryOrHash);
}

const IMPLICIT_INVITE_HASH =
  "/invite/accept#access_token=at-1&refresh_token=rt-1&expires_in=3600&token_type=bearer&type=invite";

describe("admin-generated invite link callback — installed @supabase/auth-js", () => {
  it("a pkce-flowType client (this app's configured client) DISCARDS a #access_token= callback", async () => {
    setLocation(IMPLICIT_INVITE_HASH);
    const fetchSpy = vi.fn();
    const client = newClient("pkce", fetchSpy);
    const { data } = await client.getSession();
    expect(data.session).toBeNull();
    // Rejected outright, not merely unrecognised: no /user validation call happens.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an implicit-flowType client establishes a session from the same #access_token= callback", async () => {
    setLocation(IMPLICIT_INVITE_HASH);
    const fetchSpy = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain("/user");
      return new Response(
        JSON.stringify({ id: "u1", aud: "authenticated", email: "invitee@example.com" }),
        { status: 200 },
      );
    });
    const client = newClient("implicit", fetchSpy);
    const { data } = await client.getSession();
    expect(data.session?.access_token).toBe("at-1");
    expect(data.session?.user.email).toBe("invitee@example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a pkce-flowType client fails CLOSED on ?code= with no stored verifier — no network call", async () => {
    setLocation("/invite/accept?code=some-code");
    const fetchSpy = vi.fn();
    const client = newClient("pkce", fetchSpy);
    const { error } = await client.exchangeCodeForSession("some-code");
    expect(error?.name).toBe("AuthPKCECodeVerifierMissingError");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an implicit-flowType client does NOT fix ?code= exchange — it drops the guard and still asks the server, with an empty verifier", async () => {
    setLocation("/invite/accept?code=some-code");
    const fetchSpy = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.auth_code).toBe("some-code");
      expect(body.code_verifier).toBe(""); // nothing was ever generated in this browser
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "both auth code and code verifier should be non-empty",
        }),
        { status: 400 },
      );
    });
    const client = newClient("implicit", fetchSpy);
    const { error } = await client.exchangeCodeForSession("some-code");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // a real request WAS sent — outcome is the server's, not pretended
    expect(error?.message).toContain("auth code and code verifier");
  });

  it("verifyOtp({ token_hash, type: 'invite' }) needs no PKCE verifier and establishes a session directly", async () => {
    setLocation("/invite/accept");
    const fetchSpy = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toContain("/verify");
      return new Response(
        JSON.stringify({
          access_token: "at-2",
          refresh_token: "rt-2",
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "u2", aud: "authenticated", email: "invitee@example.com" },
        }),
        { status: 200 },
      );
    });
    // flowType is irrelevant to this path — using "pkce" (this app's real
    // shared client setting) to prove it doesn't need to change for this to work.
    const client = newClient("pkce", fetchSpy);
    const { data, error } = await client.verifyOtp({ token_hash: "th-1", type: "invite" });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe("at-2");
  });

  it("verifyOtp surfaces an already-used/expired token as a normal error, not a crash", async () => {
    setLocation("/invite/accept");
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "invalid_token", error_description: "Token has expired or is invalid" }),
          { status: 403 },
        ),
    );
    const client = newClient("pkce", fetchSpy);
    const { data, error } = await client.verifyOtp({ token_hash: "th-expired", type: "invite" });
    expect(data.session).toBeNull();
    expect(error?.message).toContain("expired");
  });
});
