import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthUrl,
  GMAIL_SCOPES,
  gmailOAuthConfigured,
  gmailOAuthCredentials,
} from "../src/lib/integrations/gmail/oauth.ts";

test("gmailOAuthCredentials is null when env vars are unset", () => {
  delete process.env.GMAIL_OAUTH_CLIENT_ID;
  delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
  assert.equal(gmailOAuthCredentials(), null);
  assert.equal(gmailOAuthConfigured(), false);
});

test("gmailOAuthCredentials reads trimmed env vars when both are set", () => {
  process.env.GMAIL_OAUTH_CLIENT_ID = " client-id ";
  process.env.GMAIL_OAUTH_CLIENT_SECRET = " client-secret ";
  assert.deepEqual(gmailOAuthCredentials(), {
    clientId: "client-id",
    clientSecret: "client-secret",
  });
  assert.equal(gmailOAuthConfigured(), true);
  delete process.env.GMAIL_OAUTH_CLIENT_ID;
  delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
});

test("buildAuthUrl includes the client id, redirect uri, state and full scope list", () => {
  const url = new URL(
    buildAuthUrl("client-123", "https://app.example.com/api/integrations/gmail/callback", "nonce-abc"),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://app.example.com/api/integrations/gmail/callback",
  );
  assert.equal(url.searchParams.get("state"), "nonce-abc");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("scope"), GMAIL_SCOPES.join(" "));
});
