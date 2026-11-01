// Official Google Sheets API client (REST v4) — server-only.
//
// Auth: a Google Cloud service account. The spreadsheet must be shared with
// the service account's `client_email` (Viewer is enough; the sync only reads).
// Credentials live in server env vars and are never sent to the browser:
//
//   GOOGLE_SHEETS_CLIENT_EMAIL   service-account client_email
//   GOOGLE_SHEETS_PRIVATE_KEY    service-account private_key (PEM, \n allowed)
//   GOOGLE_SHEETS_SPREADSHEET_ID optional default sheet id
//   GOOGLE_SHEETS_TAB            optional default tab name
//
// No googleapis/google-auth-library dependency: a service-account JWT is a
// 30-line RS256 signature with node:crypto, and the two REST calls are plain
// fetch. Fewer packages to audit for a read-only integration.

import { createSign } from "node:crypto";
import { DEFAULT_SPREADSHEET_ID, DEFAULT_TAB } from "./model.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export class SheetsError extends Error {
  code: "not_configured" | "auth_failed" | "not_found" | "api_error";
  constructor(code: SheetsError["code"], message: string) {
    super(message);
    this.name = "SheetsError";
    this.code = code;
  }
}

export interface SheetsConfig {
  spreadsheetId: string;
  tab: string;
}

export function sheetsConfig(overrides: Partial<SheetsConfig> = {}): SheetsConfig {
  return {
    spreadsheetId:
      overrides.spreadsheetId?.trim() ||
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
      DEFAULT_SPREADSHEET_ID,
    tab: overrides.tab?.trim() || process.env.GOOGLE_SHEETS_TAB?.trim() || DEFAULT_TAB,
  };
}

export function sheetsCredentials(): { clientEmail: string; privateKey: string } | null {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) return null;
  return { clientEmail, privateKey };
}

/** True when credentials + a spreadsheet id are available. */
export function sheetsConfigured(): boolean {
  return (
    (sheetsCredentials() !== null ||
      Boolean(process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim())) &&
    Boolean(sheetsConfig().spreadsheetId)
  );
}

const base64url = (value: string | Buffer): string =>
  Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Build a signed service-account JWT. Exported for the unit test. */
export function buildServiceAccountJwt(
  clientEmail: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const direct = process.env.GOOGLE_SHEETS_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const credentials = sheetsCredentials();
  if (!credentials) {
    throw new SheetsError(
      "not_configured",
      "Google Sheets is not configured. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY on the server, then share the spreadsheet with that service account.",
    );
  }

  const assertion = buildServiceAccountJwt(
    credentials.clientEmail,
    credentials.privateKey,
  );
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new SheetsError(
      "auth_failed",
      `Google authentication failed (${response.status}): ${
        payload?.error_description || payload?.error || "no access token returned"
      }. Check the service-account key and that the Sheets API is enabled.`,
    );
  }
  cachedToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return payload.access_token;
}

async function sheetsFetch<T>(path: string): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${SHEETS_BASE}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) {
    throw new SheetsError(
      "auth_failed",
      `Google Sheets denied access (${response.status}). Share the spreadsheet with the service account as Viewer and confirm the Sheets API is enabled.`,
    );
  }
  if (response.status === 404) {
    throw new SheetsError(
      "not_found",
      "Spreadsheet or tab not found. Check the spreadsheet id and tab name.",
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SheetsError(
      "api_error",
      `Google Sheets API error (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

export interface SheetTab {
  title: string;
  sheetId: number;
  rowCount?: number;
  columnCount?: number;
}

export async function listTabs(spreadsheetId: string): Promise<SheetTab[]> {
  const data = await sheetsFetch<{
    properties?: { title?: string };
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }[];
  }>(`${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`);
  return (data.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? "",
    sheetId: sheet.properties?.sheetId ?? 0,
    rowCount: sheet.properties?.gridProperties?.rowCount,
    columnCount: sheet.properties?.gridProperties?.columnCount,
  }));
}

export interface SheetData {
  spreadsheetTitle: string;
  tab: string;
  values: string[][];
}

/** Read every populated cell in a tab (A:ZZ). */
export async function readSheet(
  config: SheetsConfig = sheetsConfig(),
): Promise<SheetData> {
  const meta = await sheetsFetch<{
    properties?: { title?: string };
    sheets?: { properties?: { title?: string } }[];
  }>(`${encodeURIComponent(config.spreadsheetId)}?fields=properties.title,sheets.properties.title`);

  const tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? "");
  const actualTab = tabs.find(
    (title) => title.toLowerCase() === config.tab.toLowerCase(),
  );
  if (!actualTab) {
    throw new SheetsError(
      "not_found",
      `Tab "${config.tab}" was not found. Available tabs: ${tabs.join(", ") || "none"}.`,
    );
  }

  const range = `'${actualTab.replace(/'/g, "''")}'!A:ZZ`;
  const data = await sheetsFetch<{ range?: string; values?: string[][] }>(
    `${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  );
  return {
    spreadsheetTitle: meta.properties?.title ?? "",
    tab: actualTab,
    values: data.values ?? [],
  };
}
