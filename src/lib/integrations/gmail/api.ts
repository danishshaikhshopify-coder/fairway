// Gmail REST v1 client — send + list/read, on top of a member's own OAuth
// access token (see oauth.ts for how that token is obtained/refreshed).
// Plain fetch, no googleapis dependency, matching the Sheets client's style.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiError extends Error {
  code: "auth_failed" | "api_error";
  constructor(code: GmailApiError["code"], message: string) {
    super(message);
    this.name = "GmailApiError";
    this.code = code;
  }
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const base64urlDecode = (value: string): string =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** Minimal header-value escaping: Gmail headers are a single line. */
function foldHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
  /** RFC 2822 In-Reply-To/References, for threading a reply. */
  inReplyTo?: string | null;
}

function buildRawMessage(email: OutgoingEmail): string {
  const headers = [
    `To: ${foldHeader(email.to)}`,
    `Subject: ${foldHeader(email.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  if (email.inReplyTo) {
    headers.push(`In-Reply-To: ${foldHeader(email.inReplyTo)}`);
    headers.push(`References: ${foldHeader(email.inReplyTo)}`);
  }
  const mime = `${headers.join("\r\n")}\r\n\r\n${email.body}`;
  return base64url(mime);
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new GmailApiError("auth_failed", `Gmail API denied access (${response.status}).`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GmailApiError(
      "api_error",
      `Gmail API error (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

export interface SentMessage {
  id: string;
  threadId: string;
}

export async function sendEmail(
  accessToken: string,
  email: OutgoingEmail,
): Promise<SentMessage> {
  return gmailFetch<SentMessage>(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: buildRawMessage(email) }),
  });
}

export interface GmailHeaderInfo {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
}

function headerValue(headers: { name?: string; value?: string }[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Plain-text body only — HTML-only messages fall back to the snippet. */
function extractPlainText(payload: unknown): string {
  const part = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  } | null;
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return base64urlDecode(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractPlainText(child);
    if (text) return text;
  }
  return "";
}

/** Lists recent message ids matching a Gmail search query (e.g. a sender). */
export async function listMessageIds(
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<string[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await gmailFetch<{ messages?: { id: string }[] }>(
    accessToken,
    `/messages?${params.toString()}`,
  );
  return (data.messages ?? []).map((m) => m.id);
}

export async function getMessage(
  accessToken: string,
  id: string,
): Promise<GmailHeaderInfo & { body: string }> {
  const data = await gmailFetch<{
    id: string;
    threadId: string;
    snippet?: string;
    payload?: { headers?: { name?: string; value?: string }[] } & Record<string, unknown>;
  }>(accessToken, `/messages/${encodeURIComponent(id)}?format=full`);
  const headers = data.payload?.headers ?? [];
  return {
    id: data.id,
    threadId: data.threadId,
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject"),
    date: headerValue(headers, "Date"),
    snippet: data.snippet ?? "",
    body: extractPlainText(data.payload) || data.snippet || "",
  };
}

/** Pulls just the email address out of a "Name <addr@host>" header value. */
export function extractEmailAddress(headerValueText: string): string {
  const match = headerValueText.match(/<([^>]+)>/);
  return (match ? match[1] : headerValueText).trim().toLowerCase();
}
