// Gmail OAuth (user-level "Sign in with Google" authorization-code flow).
//
// Unlike Google Sheets (one service account reading one spreadsheet), Gmail
// sends/receives as an individual person, so there is no shared workspace
// credential — each member connects their own mailbox. The OAuth *client*
// (app identity) is a server env var, set up once per deployment:
//
//   GMAIL_OAUTH_CLIENT_ID       OAuth 2.0 client id (Web application)
//   GMAIL_OAUTH_CLIENT_SECRET   OAuth 2.0 client secret
//
// The resulting per-member access/refresh tokens are stored in
// gmail_connections (see the b4 migration), never here.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Short-lived CSRF nonce, set by /authorize and checked by /callback. */
export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export class GmailOAuthError extends Error {
  code: "not_configured" | "exchange_failed" | "refresh_failed";
  constructor(code: GmailOAuthError["code"], message: string) {
    super(message);
    this.name = "GmailOAuthError";
    this.code = code;
  }
}

export interface GmailOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function gmailOAuthCredentials(): GmailOAuthCredentials | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function gmailOAuthConfigured(): boolean {
  return gmailOAuthCredentials() !== null;
}

/** Build the Google consent-screen URL. Pure — no network access. */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
}

function parseTokenPayload(payload: unknown): GmailTokens | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!value.access_token) return null;
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token ?? null,
    expiresAt: Date.now() + (value.expires_in ?? 3600) * 1000,
    scope: value.scope ?? GMAIL_SCOPES.join(" "),
  };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GmailTokens> {
  const credentials = gmailOAuthCredentials();
  if (!credentials) {
    throw new GmailOAuthError("not_configured", "Gmail OAuth is not configured on the server.");
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  const tokens = parseTokenPayload(payload);
  if (!response.ok || !tokens) {
    const body = payload as { error?: string; error_description?: string } | null;
    throw new GmailOAuthError(
      "exchange_failed",
      `Google token exchange failed (${response.status}): ${
        body?.error_description || body?.error || "no access token returned"
      }.`,
    );
  }
  return tokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
  const credentials = gmailOAuthCredentials();
  if (!credentials) {
    throw new GmailOAuthError("not_configured", "Gmail OAuth is not configured on the server.");
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  const tokens = parseTokenPayload(payload);
  if (!response.ok || !tokens) {
    throw new GmailOAuthError(
      "refresh_failed",
      `Google token refresh failed (${response.status}).`,
    );
  }
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export async function fetchGmailEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { email?: string } | null;
  return payload?.email ?? null;
}
