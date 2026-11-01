// Google Sheets connection config — shared by the API route and Settings UI.
// Pure validation, no secrets. Credentials are server env vars only.

import { DEFAULT_SPREADSHEET_ID, DEFAULT_TAB, type SheetField } from "./model";

export interface SheetsConnectionConfig {
  spreadsheetId: string;
  tab: string;
  /** Exact header text -> field name, for sheets whose headers are unusual. */
  columnMap: Record<string, string>;
}

export interface SheetsConnection {
  id: string;
  provider: "google_sheets";
  isEnabled: boolean;
  config: SheetsConnectionConfig;
  autoSync: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt: string | null;
  lastStatus: "never" | "ok" | "partial" | "failed" | null;
  lastError: string | null;
}

export interface SheetsRunSummary {
  id: string;
  mode: "dry_run" | "apply";
  triggeredBy: string;
  status: "running" | "completed" | "partial" | "failed";
  sheetTitle: string | null;
  totalRows: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  leadsCreated: number;
  leadsUpdated: number;
  skippedRows: number;
  invalidRows: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Accept a full Google Sheets URL or a bare id; return the id. */
export function normaliseSpreadsheetId(input: string): string {
  const text = input.trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return (match?.[1] ?? text).trim();
}

const VALID_FIELDS = new Set<string>([
  "company", "contact", "title", "email", "phone", "city", "region", "country",
  "website", "businessType", "companyInstagram", "companyFacebook",
  "companyLinkedIn", "perfectClientUrl", "contactInstagram", "contactFacebook",
  "contactLinkedIn", "insights", "owner", "status", "value", "score", "fitScore",
  "qualification", "recommendedAction", "lastContact", "nextFollowUp",
]);

export interface ConnectionInput {
  spreadsheetId: string;
  tab: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  columnMap: Record<string, string>;
}

export type ValidationResult =
  | { ok: true; value: ConnectionInput }
  | { ok: false; error: string };

export function validateConnectionInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const spreadsheetId = normaliseSpreadsheetId(
    typeof input.spreadsheetId === "string" ? input.spreadsheetId : "",
  );
  if (!spreadsheetId) {
    return { ok: false, error: "Spreadsheet id (or URL) is required." };
  }
  if (!/^[a-zA-Z0-9_-]{20,120}$/.test(spreadsheetId)) {
    return { ok: false, error: "That does not look like a Google spreadsheet id." };
  }

  const tab = (typeof input.tab === "string" ? input.tab : "").trim() || DEFAULT_TAB;
  if (tab.length > 100) {
    return { ok: false, error: "Tab name must be 100 characters or fewer." };
  }

  const intervalRaw = Number(input.syncIntervalMinutes ?? 360);
  const syncIntervalMinutes = Number.isFinite(intervalRaw)
    ? Math.round(intervalRaw)
    : 360;
  if (syncIntervalMinutes < 15 || syncIntervalMinutes > 10080) {
    return { ok: false, error: "Sync interval must be between 15 and 10080 minutes." };
  }

  const columnMap: Record<string, string> = {};
  if (input.columnMap !== undefined) {
    if (!input.columnMap || typeof input.columnMap !== "object") {
      return { ok: false, error: "columnMap must be an object of header -> field." };
    }
    for (const [header, field] of Object.entries(input.columnMap as Record<string, unknown>)) {
      if (typeof field !== "string" || !VALID_FIELDS.has(field)) {
        return { ok: false, error: `Unknown column mapping field "${String(field)}".` };
      }
      if (header.trim()) columnMap[header.trim()] = field as SheetField;
    }
  }

  return {
    ok: true,
    value: {
      spreadsheetId,
      tab,
      autoSync: input.autoSync === true,
      syncIntervalMinutes,
      columnMap,
    },
  };
}

export function configFromRow(config: unknown): SheetsConnectionConfig {
  const value =
    config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const columnMap: Record<string, string> = {};
  if (value.columnMap && typeof value.columnMap === "object") {
    for (const [header, field] of Object.entries(
      value.columnMap as Record<string, unknown>,
    )) {
      if (typeof field === "string") columnMap[header] = field;
    }
  }
  return {
    spreadsheetId:
      typeof value.spreadsheetId === "string" && value.spreadsheetId
        ? value.spreadsheetId
        : DEFAULT_SPREADSHEET_ID,
    tab: typeof value.tab === "string" && value.tab ? value.tab : DEFAULT_TAB,
    columnMap,
  };
}

export function connectionFromRow(row: Record<string, unknown>): SheetsConnection {
  return {
    id: String(row.id),
    provider: "google_sheets",
    isEnabled: row.is_enabled !== false,
    config: configFromRow(row.config),
    autoSync: row.auto_sync === true,
    syncIntervalMinutes:
      typeof row.sync_interval_minutes === "number"
        ? row.sync_interval_minutes
        : 360,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastStatus: (row.last_status as SheetsConnection["lastStatus"]) ?? null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export function runFromRow(row: Record<string, unknown>): SheetsRunSummary {
  return {
    id: String(row.id),
    mode: row.mode as SheetsRunSummary["mode"],
    triggeredBy: String(row.triggered_by ?? "manual"),
    status: row.status as SheetsRunSummary["status"],
    sheetTitle: row.sheet_title ? String(row.sheet_title) : null,
    totalRows: Number(row.total_rows ?? 0),
    companiesCreated: Number(row.companies_created ?? 0),
    companiesUpdated: Number(row.companies_updated ?? 0),
    contactsCreated: Number(row.contacts_created ?? 0),
    contactsUpdated: Number(row.contacts_updated ?? 0),
    leadsCreated: Number(row.leads_created ?? 0),
    leadsUpdated: Number(row.leads_updated ?? 0),
    skippedRows: Number(row.skipped_rows ?? 0),
    invalidRows: Number(row.invalid_rows ?? 0),
    errorSummary: row.error_summary ? String(row.error_summary) : null,
    startedAt: String(row.started_at ?? ""),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}
