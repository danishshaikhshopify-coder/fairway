// Lead CSV export/import for demo mode. Mirrors the B1 `lead_imports`
// contract at the UX level: header validation, per-row errors, explicit
// created/failed counts — never a silent partial import.
//
// No CSV dependency: our own export format only (RFC 4180 quoting).

import { findDuplicateLead, type LeadForm } from "./lead-form.ts";
import type { BusinessType, Lead, LeadSource } from "./types";

/** Export column order; also the accepted header order for import. */
export const LEAD_CSV_HEADERS = [
  "company",
  "contact",
  "email",
  "phone",
  "source",
  "businessType",
  "value",
  "score",
  "fitScore",
  "owner",
  "nextFollowUp",
] as const;

/** Headers a row must have to be importable at all. */
const REQUIRED_HEADERS = ["company", "contact", "email", "value"] as const;

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Serialize leads to CSV text (CRLF line endings, UTF-8, no BOM). */
export function leadsToCsv(leads: Lead[]): string {
  const lines = [LEAD_CSV_HEADERS.join(",")];
  for (const l of leads) {
    lines.push(
      [
        l.company,
        l.contact,
        l.email,
        l.phone,
        l.source,
        l.businessType,
        l.value,
        l.score,
        l.fitScore,
        l.owner,
        l.nextFollowUp,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/** Parse one CSV line honoring quotes ("" = literal quote). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Split CSV text into lines, skipping blank ones (handles CRLF/LF). */
function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

export interface ImportRowResult {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  /** Present when the row passed validation and is ready to import. */
  lead?: Omit<Lead, "id">;
  errors: string[];
}

export interface ImportResult {
  /** File-level failure (e.g. missing headers) — no rows are importable. */
  fatal: string[];
  rows: ImportRowResult[];
  /** Rows with no errors. */
  valid: ImportRowResult[];
  /** Rows with errors. */
  failed: ImportRowResult[];
}

type RawLead = Pick<LeadForm, "email" | "company"> &
  Partial<Record<(typeof LEAD_CSV_HEADERS)[number], string>>;

function isLeadSource(v: string): v is LeadSource {
  return ["Referral", "Website", "Trade show", "Cold call", "Social", "Partner"].includes(v);
}

function isBusinessType(v: string): v is BusinessType {
  return ["Commercial", "Residential", "Installer", "Seller", "Both"].includes(v);
}

const SCORE_DEFAULT = 50;

/**
 * Validate parsed CSV against existing leads. `existing` is used for
 * duplicate detection (same email + company, same rule as the add form).
 */
export function importLeadsCsv(
  text: string,
  existing: Pick<Lead, "email" | "company">[],
): ImportResult {
  const result: ImportResult = { fatal: [], rows: [], valid: [], failed: [] };
  const lines = splitLines(text);
  if (lines.length === 0) {
    result.fatal.push("The file is empty.");
    return result;
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    result.fatal.push(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `Expected headers: ${LEAD_CSV_HEADERS.join(", ")}.`,
    );
    return result;
  }

  // Within-file duplicates: email + company seen earlier in the same file.
  const seen: Pick<Lead, "email" | "company">[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const raw: RawLead = { email: "", company: "" };
    headers.forEach((h, idx) => {
      if ((LEAD_CSV_HEADERS as readonly string[]).includes(h)) {
        raw[h as (typeof LEAD_CSV_HEADERS)[number]] = (cells[idx] ?? "").trim();
      }
    });

    const line = i + 1;
    const errors: string[] = [];

    if (!raw.company) errors.push("Company is required.");
    if (!raw.contact) errors.push("Contact name is required.");
    if (!raw.email) {
      errors.push("Email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) {
      errors.push("Enter a valid email address.");
    }

    const value = Number(raw.value);
    if (
      raw.value === undefined ||
      raw.value === "" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      errors.push("Enter an estimated value in USD.");
    }

    for (const field of ["score", "fitScore"] as const) {
      const v = raw[field];
      if (v !== undefined && v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          errors.push(`${field === "score" ? "Lead" : "Business-fit"} score must be 0-100.`);
        }
      }
    }

    if (raw.source !== undefined && raw.source !== "" && !isLeadSource(raw.source)) {
      errors.push(`Unknown source "${raw.source}".`);
    }
    if (
      raw.businessType !== undefined &&
      raw.businessType !== "" &&
      !isBusinessType(raw.businessType)
    ) {
      errors.push(`Unknown business type "${raw.businessType}".`);
    }

    const probe = { email: raw.email, company: raw.company };
    if (errors.length === 0) {
      if (findDuplicateLead(existing, probe)) {
        errors.push("Duplicate — a lead with this email and company already exists.");
      } else if (findDuplicateLead(seen, probe)) {
        errors.push("Duplicate — this email and company appears earlier in the file.");
      }
    }

    const row: ImportRowResult = { line, errors };
    if (errors.length === 0) {
      seen.push(probe);
      row.lead = {
        company: raw.company,
        contact: raw.contact ?? "",
        email: raw.email,
        phone: raw.phone ?? "",
        source:
          raw.source && isLeadSource(raw.source) ? raw.source : "Cold call",
        status: "new",
        score:
          raw.score === undefined || raw.score === ""
            ? SCORE_DEFAULT
            : Number(raw.score),
        fitScore:
          raw.fitScore === undefined || raw.fitScore === ""
            ? SCORE_DEFAULT
            : Number(raw.fitScore),
        businessType:
          raw.businessType && isBusinessType(raw.businessType)
            ? raw.businessType
            : "Both",
        value,
        owner: raw.owner && raw.owner.trim() !== "" ? raw.owner : "A. Rivera",
        lastContact: new Date().toISOString().slice(0, 10),
        nextFollowUp: raw.nextFollowUp ?? "",
        evidence: "Imported from CSV in the demo UI — no automated scoring applied.",
        followUpEvidence: "No follow-up history captured yet.",
        qualification: "Pending",
        recommendedAction: "Run a first discovery call and capture qualification notes.",
        cadencePaused: false,
      };
      result.valid.push(row);
    } else {
      result.failed.push(row);
    }
    result.rows.push(row);
  }

  return result;
}

/** Trigger a browser download of CSV text. Client-only (uses Blob + anchor). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
