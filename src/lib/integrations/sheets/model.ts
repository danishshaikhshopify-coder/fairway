// Google Sheets import model — pure functions only.
//
// This module is deliberately free of Next/Supabase imports so `node --test`
// can load it directly (tests/sheets-*.test.ts). It owns:
//   * header detection + alias mapping (the BACKUP_BEFORE_CRM tab is not ours,
//     so columns are matched by name, never by position),
//   * per-row validation and normalisation,
//   * STABLE identity keys (`sync_key`) derived from natural keys — never from
//     spreadsheet row numbers, so sorting/inserting rows cannot create dupes,
//   * a dry-run plan that says exactly what an apply would create/update/skip.
//
// Blank cells are represented as "" / null and are never written over a
// meaningful CRM value by the apply layer (see sync.ts).

import type { Country, LeadStatus, Qualification } from "../../types";

export const DEFAULT_SPREADSHEET_ID =
  "135Q7aVzsYDpQtghfyLJVx1bR46CYmkEUu4pBu-8IdHI";
export const DEFAULT_TAB = "BACKUP_BEFORE_CRM";

export type SheetField =
  | "company"
  | "contact"
  | "title"
  | "email"
  | "contactEmail"
  | "phone"
  | "city"
  | "region"
  | "country"
  | "website"
  | "businessType"
  | "companyInstagram"
  | "companyFacebook"
  | "companyLinkedIn"
  | "perfectClientUrl"
  | "contactInstagram"
  | "contactFacebook"
  | "contactLinkedIn"
  | "insights"
  | "owner"
  | "status"
  | "value"
  | "score"
  | "fitScore"
  | "qualification"
  | "recommendedAction"
  | "lastContact"
  | "nextFollowUp";

/**
 * Header aliases, already normalised (lowercase, alphanumerics only).
 * Order matters only for readability; the first alias that matches wins.
 *
 * Social columns are split company/contact by an explicit owner/contact/person
 * prefix. A bare "instagram"/"linkedin" defaults to the COMPANY because that
 * is the common lead-gen layout; `column_map` in the connection config can
 * override any header when a sheet differs.
 */
export const FIELD_ALIASES: Record<SheetField, string[]> = {
  company: [
    "company", "companyname", "business", "businessname", "organization",
    "organisation", "org", "dealer", "dealership", "store", "shop", "brand",
    "account", "accountname",
    // "Client Abondant" is BACKUP_BEFORE_CRM's actual lead/company-name column.
    "clientabondant", "clientabundant",
  ],
  contact: [
    "contact", "contactname", "contactperson", "ownername", "owner", "person",
    "fullname", "name", "primarycontact", "decisionmaker",
  ],
  title: ["title", "jobtitle", "role", "position", "contacttitle", "ownertitle"],
  // The company/business address. "Owner Email" and "Contact Email" are
  // claimed by `contactEmail` below — a sheet with BOTH columns (like
  // BACKUP_BEFORE_CRM: "Owner Email" + "Business Email") must keep them on
  // separate CRM records, not collapse them into one.
  email: [
    "email", "emailaddress", "workemail", "primaryemail", "businessemail",
    "companyemail", "email1",
  ],
  contactEmail: [
    "owneremail", "contactemail", "personalemail", "decisionmakeremail",
    "primarycontactemail",
  ],
  phone: [
    "phone", "phonenumber", "contactphone", "ownerphone", "ownerphonenumber",
    "telephone", "tel", "mobile", "mobilephone", "cell", "cellphone", "whatsapp",
  ],
  city: ["city", "town", "municipality"],
  region: ["region", "state", "province", "stateprovince", "county"],
  country: ["country", "countryname"],
  website: ["website", "companywebsite", "web", "url", "site", "companyurl", "domain"],
  businessType: [
    "businesstype", "type", "category", "companytype", "sellerinstaller",
    "sellertype", "businesscategory",
  ],
  companyInstagram: [
    "companyinstagram", "companyinstagramurl", "companyig", "businessinstagram",
    "businessinstagramurl", "instagram", "instagramurl", "ig", "instagramhandle",
    "insta",
  ],
  companyFacebook: [
    "companyfacebook", "companyfacebookurl", "companyfb", "businessfacebook",
    "businessfacebookurl", "facebook", "facebookurl", "fb", "facebookpage",
  ],
  companyLinkedIn: [
    "companylinkedin", "companylinkedinurl", "businesslinkedin",
    "businesslinkedinurl", "linkedin", "linkedinurl", "companylinkedinpage",
  ],
  perfectClientUrl: [
    "perfectclient", "perfectclienturl", "perfectclientlink", "idealcustomer",
    "idealcustomerurl", "perfectcustomer", "perfectcustomerurl",
    "referenceclient", "referenceclienturl", "exampleclient", "exampleurl",
    "lookalike", "lookalikeurl",
  ],
  contactInstagram: [
    "contactinstagram", "contactinstagramurl", "ownerinstagram",
    "ownerinstagramurl", "personinstagram", "personalinstagram",
    "contactig", "ownerig",
  ],
  contactFacebook: [
    "contactfacebook", "contactfacebookurl", "ownerfacebook",
    "ownerfacebookurl", "personfacebook", "personalfacebook", "contactfb",
    "ownerfb",
  ],
  contactLinkedIn: [
    "contactlinkedin", "contactlinkedinurl", "ownerlinkedin",
    "ownerlinkedinurl", "personlinkedin", "personallinkedin",
  ],
  insights: [
    "insights", "insight", "notes", "note", "comments", "comment", "remarks",
    "description", "details", "painpoints", "opportunity", "leadnotes",
    "additionalnotes", "internalnotes", "summary",
    // "Client Insight" is BACKUP_BEFORE_CRM's actual notes column.
    "clientinsight", "clientinsights",
  ],
  owner: ["assignedto", "leadowner", "salesrep", "accountowner", "assignedowner"],
  status: ["status", "stage", "pipelinestage", "leadstatus", "pipeline"],
  value: [
    "value", "dealvalue", "estimatedvalue", "opportunityvalue", "amount",
    "budget", "potentialvalue", "estimateddealvalue",
  ],
  score: ["score", "leadscore", "priorityscore"],
  fitScore: ["fitscore", "businessfitscore", "fit"],
  qualification: ["qualification", "qualified", "qualstatus", "rating"],
  recommendedAction: [
    "recommendedaction", "nextstep", "nextaction", "action", "nextsteps",
  ],
  lastContact: ["lastcontact", "lastcontacted", "lastcontactdate", "lasttouch"],
  nextFollowUp: [
    "nextfollowup", "followup", "followupdate", "nextfollowupdate",
    "followupdateg",
  ],
};

export const FIELD_LABELS: Record<SheetField, string> = {
  company: "Company",
  contact: "Contact / owner",
  title: "Title",
  email: "Company email",
  contactEmail: "Owner / contact email",
  phone: "Phone",
  city: "City",
  region: "Region",
  country: "Country",
  website: "Website",
  businessType: "Business type",
  companyInstagram: "Company Instagram",
  companyFacebook: "Company Facebook",
  companyLinkedIn: "Company LinkedIn",
  perfectClientUrl: "Perfect Client URL",
  contactInstagram: "Owner Instagram",
  contactFacebook: "Owner Facebook",
  contactLinkedIn: "Owner LinkedIn",
  insights: "Insights",
  owner: "Assigned owner",
  status: "Status",
  value: "Deal value",
  score: "Lead score",
  fitScore: "Fit score",
  qualification: "Qualification",
  recommendedAction: "Recommended action",
  lastContact: "Last contact",
  nextFollowUp: "Next follow-up",
};

export interface ColumnMap {
  /** field -> 0-based column index in the sheet */
  fields: Partial<Record<SheetField, number>>;
  /** original header text for each mapped field */
  headers: Partial<Record<SheetField, string>>;
  /** header text -> field, for the report */
  detected: Record<string, SheetField>;
  /** headers present but not mapped */
  unmapped: string[];
}

export interface HeaderDetection {
  headerRow: number;
  columns: ColumnMap;
  recognized: number;
}

const normaliseHeader = (value: string): string =>
  value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** Normalise a value for stable comparison (accent-insensitive, punctuation-free). */
export function normaliseKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

const ALIAS_TO_FIELD: Map<string, SheetField> = (() => {
  const map = new Map<string, SheetField>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [
    SheetField,
    string[],
  ][]) {
    for (const alias of aliases) map.set(normaliseHeader(alias), field);
  }
  return map;
})();

/**
 * Find the header row and map columns by name.
 *
 * Sheets often have title/banner rows above the real header, so the first 15
 * rows are scored: a header row must contain a company-ish column plus at
 * least one other recognised column. Highest score wins, earliest on ties.
 */
export function detectHeader(
  values: string[][],
  overrides: Record<string, string> = {},
): HeaderDetection | { error: string } {
  let best: { row: number; columns: ColumnMap; recognized: number } | null = null;

  const scan = Math.min(values.length, 15);
  for (let row = 0; row < scan; row++) {
    const raw = values[row] ?? [];
    const fields: Partial<Record<SheetField, number>> = {};
    const headers: Partial<Record<SheetField, string>> = {};
    const detected: Record<string, SheetField> = {};
    const unmapped: string[] = [];

    raw.forEach((cell, index) => {
      const text = String(cell ?? "").trim();
      if (!text) return;
      const overrideField = overrides[text] as SheetField | undefined;
      const field = overrideField ?? ALIAS_TO_FIELD.get(normaliseHeader(text));
      if (!field) {
        unmapped.push(text);
        return;
      }
      // First occurrence wins; a second column for the same field is reported
      // as unmapped so nothing is silently swallowed.
      if (fields[field] !== undefined) {
        unmapped.push(text);
        return;
      }
      fields[field] = index;
      headers[field] = text;
      detected[text] = field;
    });

    const recognized = Object.keys(fields).length;
    if (fields.company === undefined) continue;
    if (recognized < 2) continue;
    if (!best || recognized > best.recognized) {
      best = { row, recognized, columns: { fields, headers, detected, unmapped } };
    }
  }

  if (!best) {
    return {
      error:
        "Could not find a header row. Expected a row containing at least a Company column plus one other recognised column (contact, email, phone, website…).",
    };
  }
  return { headerRow: best.row, columns: best.columns, recognized: best.recognized };
}

// --- value normalisers -----------------------------------------------------

const firstEmail = (value: string): string => {
  const matches = value.match(/[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/g);
  return matches?.[0]?.trim() ?? "";
};

const parseNumber = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.,\-kKmM]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const multiplier = /k$/i.test(cleaned) ? 1000 : /m$/i.test(cleaned) ? 1_000_000 : 1;
  const n = Number(cleaned.replace(/[kKmM]$/, ""));
  if (!Number.isFinite(n)) return null;
  return n * multiplier;
};

const parseScore = (value: string): number | null => {
  const n = parseNumber(value);
  if (n === null) return null;
  return n >= 0 && n <= 100 ? Math.round(n) : null;
};

const parseDate = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  // ISO first: no timezone surprises.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const URL_RE = /^(https?:\/\/|www\.)/i;
// A bare domain already (e.g. "ig.com/apex", "instagram.com/apex") — the
// first path segment itself looks like a hostname, so it is not a handle.
const DOMAIN_RE = /^[^\s/]+\.[a-z]{2,}(\/|$)/i;

function normaliseUrl(value: string, kind: "website" | "instagram" | "facebook" | "linkedin"): string {
  const text = value.trim();
  if (!text) return "";
  if (URL_RE.test(text)) return text.startsWith("http") ? text : `https://${text}`;
  if (DOMAIN_RE.test(text)) return `https://${text}`;
  if (text.startsWith("@")) {
    const handle = text.slice(1);
    if (kind === "instagram") return `https://instagram.com/${handle}`;
    if (kind === "linkedin") return `https://linkedin.com/in/${handle}`;
    if (kind === "facebook") return `https://facebook.com/${handle}`;
  }
  if (kind === "instagram") return `https://instagram.com/${text.replace(/^\/+/, "")}`;
  if (kind === "linkedin") return `https://linkedin.com/in/${text.replace(/^\/+/, "")}`;
  if (kind === "facebook") return `https://facebook.com/${text.replace(/^\/+/, "")}`;
  return `https://${text}`;
}

function normaliseBusinessType(value: string): "Seller" | "Installer" | "Both" | null {
  const v = normaliseKey(value);
  if (!v) return null;
  if (v.includes("both") || (v.includes("sell") && v.includes("install"))) return "Both";
  if (v.includes("install")) return "Installer";
  if (v.includes("sell") || v.includes("dealer") || v.includes("retail") || v.includes("reseller")) {
    return "Seller";
  }
  return null;
}

function normaliseStatus(value: string): LeadStatus | null {
  const v = normaliseKey(value);
  if (!v) return null;
  if (v.includes("won") || v.includes("closed won") || v === "sale") return "won";
  if (v.includes("lost") || v.includes("closed lost")) return "lost";
  if (v.includes("proposal") || v.includes("quote") || v.includes("negotiat")) return "proposal";
  if (v.includes("qualified") || v.includes("qualif")) return "qualified";
  if (v.includes("contact") || v.includes("reach") || v.includes("follow")) return "contacted";
  if (v.includes("new") || v.includes("lead") || v.includes("open")) return "new";
  return null;
}

function normaliseQualification(value: string): Qualification | null {
  const v = normaliseKey(value);
  if (!v) return null;
  if (v.includes("disqual")) return "Disqualified";
  if (v.includes("needs review") || v.includes("review")) return "Needs review";
  if (v.includes("qualified")) return "Qualified";
  if (v.includes("pending")) return "Pending";
  return null;
}

function normaliseCountry(value: string): Country | null {
  const v = normaliseKey(value);
  if (!v) return null;
  if (["usa", "us", "united states", "united states of america", "america"].includes(v)) {
    return "USA";
  }
  if (["canada", "ca", "can"].includes(v)) return "Canada";
  if (["mexico", "mx", "mex"].includes(v)) return "Mexico";
  return null;
}

// --- row model -------------------------------------------------------------

export interface CompanyFields {
  name: string;
  businessType: "Seller" | "Installer" | "Both";
  city: string;
  region: string;
  country: Country;
  website: string;
  email: string;
  phone: string;
  notes: string;
  instagramUrl: string;
  facebookUrl: string;
  linkedinUrl: string;
  perfectClientUrl: string;
  owner: string;
}

export interface ContactFields {
  name: string;
  title: string;
  email: string;
  phone: string;
  owner: string;
  linkedinUrl: string;
  instagramUrl: string;
  facebookUrl: string;
}

export interface LeadFields {
  company: string;
  contact: string;
  email: string;
  phone: string;
  source: "Google Sheets";
  status: LeadStatus;
  businessType: "Seller" | "Installer" | "Both";
  value: number;
  score: number | null;
  fitScore: number | null;
  qualification: Qualification;
  evidence: string;
  followUpEvidence: string;
  recommendedAction: string;
  owner: string;
  lastContact: string;
  nextFollowUp: string;
}

export interface MappedRow {
  /** 1-based spreadsheet row number (header included). */
  line: number;
  company: CompanyFields;
  contact: ContactFields | null;
  lead: LeadFields;
  /**
   * Which cells were actually non-blank. Defaults are applied to the model so
   * a create is always valid, but an UPDATE must only send fields the sheet
   * really populated — a blank cell never overwrites a CRM value.
   */
  present: Record<string, boolean>;
  companyKey: string;
  contactKey: string | null;
  leadKey: string;
  errors: string[];
  warnings: string[];
}

export interface MapRowsOptions {
  /** Exact header text -> field overrides from the connection config. */
  columnMap?: Record<string, string>;
}

export interface MapRowsResult {
  headerRow: number;
  columns: ColumnMap;
  rows: MappedRow[];
  /** Rows that could not be mapped at all (e.g. no company). */
  invalid: { line: number; errors: string[] }[];
  /** Completely blank rows, counted but not reported as errors. */
  blankRows: number;
  /** Recognised headers that were not present in the sheet. */
  missingFields: SheetField[];
}

export function mapRows(
  values: string[][],
  options: MapRowsOptions = {},
): MapRowsResult | { error: string } {
  const detected = detectHeader(values, options.columnMap);
  if ("error" in detected) return detected;
  const { headerRow, columns } = detected;

  const rows: MappedRow[] = [];
  const invalid: { line: number; errors: string[] }[] = [];
  let blankRows = 0;

  for (let index = headerRow + 1; index < values.length; index++) {
    const raw = values[index] ?? [];
    const cell = (field: SheetField): string => {
      const col = columns.fields[field];
      return col === undefined ? "" : String(raw[col] ?? "").trim();
    };
    const hasAny = raw.some((v) => String(v ?? "").trim() !== "");
    if (!hasAny) {
      blankRows++;
      continue;
    }

    const line = index + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    const companyName = cell("company");
    if (!companyName) {
      errors.push("Company name is required.");
    }

    const rawEmail = cell("email");
    const email = firstEmail(rawEmail);
    if (rawEmail && !email) warnings.push(`Ignored invalid company email "${rawEmail}".`);
    if (rawEmail && (rawEmail.match(/@/g) ?? []).length > 1) {
      warnings.push("Multiple company emails in one cell — kept the first.");
    }

    // A sheet with distinct "Owner Email" / "Business Email" columns (like
    // BACKUP_BEFORE_CRM) must keep them on separate records. A sheet with
    // only one generic "Email" column uses it for both.
    const rawContactEmail = cell("contactEmail");
    const contactEmail = firstEmail(rawContactEmail) || email;
    if (rawContactEmail && !firstEmail(rawContactEmail)) {
      warnings.push(`Ignored invalid owner email "${rawContactEmail}".`);
    }

    const insights = cell("insights");
    const businessType =
      normaliseBusinessType(cell("businessType")) ?? "Seller";
    const country = normaliseCountry(cell("country")) ?? "USA";
    const status = normaliseStatus(cell("status")) ?? "new";
    const qualification = normaliseQualification(cell("qualification")) ?? "Pending";
    const value = parseNumber(cell("value")) ?? 0;
    const score = parseScore(cell("score"));
    const fitScore = parseScore(cell("fitScore"));
    if (cell("score") && score === null) warnings.push("Ignored invalid lead score (expected 0-100).");
    if (cell("fitScore") && fitScore === null) warnings.push("Ignored invalid fit score (expected 0-100).");
    if (cell("value") && parseNumber(cell("value")) === null) warnings.push("Ignored unreadable deal value.");

    const contactName = cell("contact");
    const hasContact = contactName !== "" || contactEmail !== "";
    const contact: ContactFields | null = hasContact
      ? {
          name: contactName || contactEmail.split("@")[0] || "",
          title: cell("title"),
          email: contactEmail,
          phone: cell("phone"),
          owner: cell("owner"),
          linkedinUrl: normaliseUrl(cell("contactLinkedIn"), "linkedin"),
          instagramUrl: normaliseUrl(cell("contactInstagram"), "instagram"),
          facebookUrl: normaliseUrl(cell("contactFacebook"), "facebook"),
        }
      : null;

    const company: CompanyFields = {
      name: companyName,
      businessType,
      city: cell("city"),
      region: cell("region"),
      country,
      website: normaliseUrl(cell("website"), "website"),
      email,
      phone: cell("phone"),
      notes: insights,
      instagramUrl: normaliseUrl(cell("companyInstagram"), "instagram"),
      facebookUrl: normaliseUrl(cell("companyFacebook"), "facebook"),
      linkedinUrl: normaliseUrl(cell("companyLinkedIn"), "linkedin"),
      perfectClientUrl: normaliseUrl(cell("perfectClientUrl"), "website"),
      owner: cell("owner"),
    };

    const lead: LeadFields = {
      company: companyName,
      contact: contact?.name ?? "",
      email: contactEmail,
      phone: cell("phone"),
      source: "Google Sheets",
      status,
      businessType,
      value,
      score,
      fitScore,
      qualification,
      evidence: insights || "Imported from Google Sheets — no automated scoring applied.",
      followUpEvidence: "",
      recommendedAction: cell("recommendedAction"),
      owner: cell("owner"),
      lastContact: parseDate(cell("lastContact")) ?? "",
      nextFollowUp: parseDate(cell("nextFollowUp")) ?? "",
    };
    if (cell("lastContact") && !lead.lastContact) warnings.push("Ignored unreadable last-contact date.");
    if (cell("nextFollowUp") && !lead.nextFollowUp) warnings.push("Ignored unreadable follow-up date.");

    if (errors.length > 0) {
      invalid.push({ line, errors });
      continue;
    }
    const present: Record<string, boolean> = {
      "company.name": companyName !== "",
      "company.businessType": cell("businessType") !== "",
      "company.city": cell("city") !== "",
      "company.region": cell("region") !== "",
      "company.country": cell("country") !== "",
      "company.website": cell("website") !== "",
      "company.email": email !== "",
      "company.phone": cell("phone") !== "",
      "company.notes": insights !== "",
      "company.instagramUrl": cell("companyInstagram") !== "",
      "company.facebookUrl": cell("companyFacebook") !== "",
      "company.linkedinUrl": cell("companyLinkedIn") !== "",
      "company.perfectClientUrl": cell("perfectClientUrl") !== "",
      "company.owner": cell("owner") !== "",
      "contact.name": contact?.name !== "" && contact !== null,
      "contact.title": cell("title") !== "",
      "contact.email": contactEmail !== "",
      "contact.phone": cell("phone") !== "",
      "contact.owner": cell("owner") !== "",
      "contact.linkedinUrl": cell("contactLinkedIn") !== "",
      "contact.instagramUrl": cell("contactInstagram") !== "",
      "contact.facebookUrl": cell("contactFacebook") !== "",
      "lead.contact": contact?.name !== "" && contact !== null,
      "lead.email": contactEmail !== "",
      "lead.phone": cell("phone") !== "",
      "lead.status": cell("status") !== "",
      "lead.businessType": cell("businessType") !== "",
      "lead.value": cell("value") !== "",
      "lead.score": score !== null,
      "lead.fitScore": fitScore !== null,
      "lead.qualification": cell("qualification") !== "",
      "lead.evidence": insights !== "",
      "lead.recommendedAction": cell("recommendedAction") !== "",
      "lead.owner": cell("owner") !== "",
      "lead.lastContact": lead.lastContact !== "",
      "lead.nextFollowUp": lead.nextFollowUp !== "",
    };
    rows.push({
      line,
      company,
      contact,
      lead,
      present,
      companyKey: companyKey(company.name),
      contactKey: contact ? contactKey(contact, company.name) : null,
      leadKey: leadKey(lead),
      errors,
      warnings,
    });
  }

  const missingFields = (Object.keys(FIELD_ALIASES) as SheetField[]).filter(
    (field) => columns.fields[field] === undefined,
  );

  return { headerRow, columns, rows, invalid, blankRows, missingFields };
}

// --- stable identity -------------------------------------------------------

export function companyKey(name: string): string {
  return `gs:company:${normaliseKey(name)}`;
}

export function contactKey(contact: ContactFields, companyName: string): string {
  const email = normaliseEmail(contact.email);
  if (email) return `gs:contact:${email}`;
  return `gs:contact:${normaliseKey(contact.name)}|${normaliseKey(companyName)}`;
}

export function leadKey(lead: LeadFields): string {
  const email = normaliseEmail(lead.email);
  if (email) return `gs:lead:${email}|${normaliseKey(lead.company)}`;
  return `gs:lead:${normaliseKey(lead.contact)}|${normaliseKey(lead.company)}`;
}

// --- dry-run plan ----------------------------------------------------------

export interface ExistingCompany {
  id: string;
  name: string;
  sync_key?: string | null;
}
export interface ExistingContact {
  id: string;
  name: string;
  email?: string | null;
  companyName?: string | null;
  sync_key?: string | null;
}
export interface ExistingLead {
  id: string;
  company: string;
  contact: string;
  email?: string | null;
  sync_key?: string | null;
}

export interface ExistingSnapshot {
  companies: ExistingCompany[];
  contacts: ExistingContact[];
  leads: ExistingLead[];
}

export type PlanAction = "create" | "update" | "skip";

export interface EntityPlan {
  action: PlanAction;
  key: string;
  matchId: string | null;
  /** Why a row/entity is skipped or why it matched. */
  reason?: string;
}

export interface RowPlan {
  line: number;
  companyName: string;
  contactName: string;
  email: string;
  company: EntityPlan;
  contact: EntityPlan | null;
  lead: EntityPlan;
  warnings: string[];
}

export interface PlanCounts {
  totalRows: number;
  companies: { create: number; update: number; skip: number };
  contacts: { create: number; update: number; skip: number };
  leads: { create: number; update: number; skip: number };
  skippedRows: number;
  invalidRows: number;
  duplicateRows: number;
}

export interface SyncPlan {
  rows: RowPlan[];
  counts: PlanCounts;
  invalid: { line: number; errors: string[] }[];
  duplicates: { line: number; reason: string }[];
  headers: Record<string, string>;
  unmappedHeaders: string[];
  missingFields: SheetField[];
}

const emptyCounts = (): PlanCounts => ({
  totalRows: 0,
  companies: { create: 0, update: 0, skip: 0 },
  contacts: { create: 0, update: 0, skip: 0 },
  leads: { create: 0, update: 0, skip: 0 },
  skippedRows: 0,
  invalidRows: 0,
  duplicateRows: 0,
});

/**
 * Compare mapped sheet rows with the current CRM snapshot.
 *
 * Matching order per entity:
 *   1. existing `sync_key` (stable across renames/sorts),
 *   2. natural key (company name / contact email / lead email+company).
 * A natural-key match is an UPDATE and the apply layer stamps the sync_key, so
 * every subsequent sync uses the stable key.
 */
export function buildSyncPlan(
  mapped: MapRowsResult,
  existing: ExistingSnapshot,
): SyncPlan {
  const counts = emptyCounts();
  counts.totalRows = mapped.rows.length + mapped.invalid.length;
  counts.invalidRows = mapped.invalid.length;

  const companiesBySyncKey = new Map<string, ExistingCompany>();
  const companiesByNatural = new Map<string, ExistingCompany>();
  for (const c of existing.companies) {
    if (c.sync_key) companiesBySyncKey.set(c.sync_key, c);
    companiesByNatural.set(normaliseKey(c.name), c);
  }

  const contactsBySyncKey = new Map<string, ExistingContact>();
  const contactsByEmail = new Map<string, ExistingContact>();
  const contactsByNameCompany = new Map<string, ExistingContact>();
  for (const c of existing.contacts) {
    if (c.sync_key) contactsBySyncKey.set(c.sync_key, c);
    if (c.email) contactsByEmail.set(normaliseEmail(c.email), c);
    contactsByNameCompany.set(
      `${normaliseKey(c.name)}|${normaliseKey(c.companyName ?? "")}`,
      c,
    );
  }

  const leadsBySyncKey = new Map<string, ExistingLead>();
  const leadsByEmailCompany = new Map<string, ExistingLead>();
  const leadsByContactCompany = new Map<string, ExistingLead>();
  for (const l of existing.leads) {
    if (l.sync_key) leadsBySyncKey.set(l.sync_key, l);
    if (l.email) {
      leadsByEmailCompany.set(
        `${normaliseEmail(l.email)}|${normaliseKey(l.company)}`,
        l,
      );
    }
    leadsByContactCompany.set(
      `${normaliseKey(l.contact)}|${normaliseKey(l.company)}`,
      l,
    );
  }

  const rows: RowPlan[] = [];
  const duplicates: { line: number; reason: string }[] = [];
  const seenCompany = new Set<string>();
  const seenContact = new Set<string>();
  const seenLead = new Set<string>();

  const planEntity = (
    kind: "company" | "contact" | "lead",
    key: string,
    match: { id: string } | undefined,
    duplicate: boolean,
  ): EntityPlan => {
    if (duplicate) {
      counts[kind === "company" ? "companies" : kind === "contact" ? "contacts" : "leads"].skip++;
      return { action: "skip", key, matchId: match?.id ?? null, reason: "Duplicate row in this sheet." };
    }
    if (match) {
      counts[kind === "company" ? "companies" : kind === "contact" ? "contacts" : "leads"].update++;
      return { action: "update", key, matchId: match.id };
    }
    counts[kind === "company" ? "companies" : kind === "contact" ? "contacts" : "leads"].create++;
    return { action: "create", key, matchId: null };
  };

  for (const row of mapped.rows) {
    const cKey = companyKey(row.company.name);
    const companyMatch =
      companiesBySyncKey.get(cKey) ??
      companiesByNatural.get(normaliseKey(row.company.name));
    const companyDuplicate = seenCompany.has(cKey);
    if (companyDuplicate) {
      duplicates.push({ line: row.line, reason: `Company "${row.company.name}" appears more than once; extra row merged.` });
    }
    seenCompany.add(cKey);

    let contactPlan: EntityPlan | null = null;
    let contactDuplicate = false;
    if (row.contact) {
      const ctKey = contactKey(row.contact, row.company.name);
      const contactMatch =
        contactsBySyncKey.get(ctKey) ??
        (row.contact.email
          ? contactsByEmail.get(normaliseEmail(row.contact.email))
          : undefined) ??
        contactsByNameCompany.get(
          `${normaliseKey(row.contact.name)}|${normaliseKey(row.company.name)}`,
        );
      contactDuplicate = seenContact.has(ctKey);
      seenContact.add(ctKey);
      contactPlan = planEntity("contact", ctKey, contactMatch, contactDuplicate);
    }

    const lKey = leadKey(row.lead);
    const leadMatch =
      leadsBySyncKey.get(lKey) ??
      (row.lead.email
        ? leadsByEmailCompany.get(
            `${normaliseEmail(row.lead.email)}|${normaliseKey(row.lead.company)}`,
          )
        : undefined) ??
      leadsByContactCompany.get(
        `${normaliseKey(row.lead.contact)}|${normaliseKey(row.lead.company)}`,
      );
    const leadDuplicate = seenLead.has(lKey);
    if (leadDuplicate) {
      duplicates.push({ line: row.line, reason: `Lead for "${row.lead.company}" appears more than once; extra row skipped.` });
    }
    seenLead.add(lKey);

    const rowPlan: RowPlan = {
      line: row.line,
      companyName: row.company.name,
      contactName: row.contact?.name ?? "",
      email: row.lead.email,
      company: planEntity("company", cKey, companyMatch, companyDuplicate),
      contact: contactPlan,
      lead: planEntity("lead", lKey, leadMatch, leadDuplicate),
      warnings: row.warnings,
    };
    if (companyDuplicate && leadDuplicate) counts.skippedRows++;
    if (leadDuplicate) counts.duplicateRows++;
    rows.push(rowPlan);
  }

  const headers: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapped.columns.headers)) {
    headers[field] = String(header);
  }

  return {
    rows,
    counts,
    invalid: mapped.invalid,
    duplicates,
    headers,
    unmappedHeaders: mapped.columns.unmapped,
    missingFields: mapped.missingFields,
  };
}
