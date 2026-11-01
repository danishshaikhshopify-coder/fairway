// Gmail OAuth callback. Exchanges the authorization code for tokens, stores
// them on the signed-in member's own gmail_connections row (RLS prevents
// anyone else from reading or writing it), then redirects back to Settings.
//
// This exchange call itself cannot be exercised end-to-end without a real
// Google Cloud OAuth client and a completed consent screen — it is untested
// against the live Google endpoint. The request/response shape it expects
// matches Google's documented token endpoint exactly, and the surrounding
// state-cookie/error handling is covered by tests/gmail-oauth.test.ts.

import { cookies } from "next/headers";
import { requireActor } from "@/lib/api/auth";
import {
  exchangeCodeForTokens,
  fetchGmailEmail,
  GMAIL_OAUTH_STATE_COOKIE,
} from "@/lib/integrations/gmail/oauth";

const SETTINGS_URL = "/settings?tab=integrations";

function redirectWithError(origin: string, message: string): Response {
  const url = new URL(SETTINGS_URL, origin);
  url.searchParams.set("gmailError", message);
  return Response.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;
  const { db, workspaceId, memberId } = result.actor;

  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value ?? null;
  cookieStore.delete(GMAIL_OAUTH_STATE_COOKIE);

  if (oauthError) {
    return redirectWithError(origin, `Google declined the request (${oauthError}).`);
  }
  if (!code || !state) {
    return redirectWithError(origin, "Missing authorization code.");
  }
  if (!expectedState || state !== expectedState) {
    return redirectWithError(origin, "The sign-in request expired or was tampered with. Try again.");
  }

  const redirectUri = `${origin}/api/integrations/gmail/callback`;
  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const email = await fetchGmailEmail(tokens.accessToken);

    const { error } = await db.from("gmail_connections").upsert(
      {
        workspace_id: workspaceId,
        member_id: memberId,
        email,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_expires_at: new Date(tokens.expiresAt).toISOString(),
        scopes: tokens.scope,
        connected_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "member_id" },
    );
    if (error) return redirectWithError(origin, error.message);
  } catch (error) {
    return redirectWithError(
      origin,
      error instanceof Error ? error.message : "Could not finish connecting Gmail.",
    );
  }

  return Response.redirect(new URL(SETTINGS_URL, origin));
}
