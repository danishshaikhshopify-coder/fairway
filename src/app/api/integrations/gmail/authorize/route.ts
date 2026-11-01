// Starts the Gmail "Connect your mailbox" flow for the signed-in member.
// Requires GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET to be set (see
// src/lib/integrations/gmail/oauth.ts for the exact Google Cloud setup).

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { requireActor } from "@/lib/api/auth";
import { buildAuthUrl, gmailOAuthCredentials, GMAIL_OAUTH_STATE_COOKIE } from "@/lib/integrations/gmail/oauth";

export async function GET(request: Request): Promise<Response> {
  const result = await requireActor();
  if (result.response) return result.response;

  const credentials = gmailOAuthCredentials();
  if (!credentials) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Gmail OAuth is not configured. Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET on the server first.",
      },
      { status: 503 },
    );
  }

  const redirectUri = `${new URL(request.url).origin}/api/integrations/gmail/callback`;
  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return Response.redirect(buildAuthUrl(credentials.clientId, redirectUri, state));
}
