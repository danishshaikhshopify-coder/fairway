// Row <-> frontend type mapping for live (Supabase) mode.
//
// Pure functions only: no client, no fetch, no React. The B1 plan (§10) maps
// the mock types onto the B1 schema, and two fields need lookup tables rather
// than a straight rename:
//
//   - `owner` is a display string in the UI but `owner_id uuid` in the DB,
//     pointing at workspace_members -> profiles.full_name. A member deleted
//     from the workspace leaves owner_id null, which the UI renders as
//     "Unassigned".
//   - `source` is a closed string union in the UI but `source_id uuid` in the
//     DB, pointing at lead_sources.name (workspace-scoped).
//
// So every mapping takes a Directory of pre-resolved lookups. Building the
// directory is one query per table; the mappings themselves stay sync and
// unit-testable.

import type {
  Activity,
  BusinessType,
  Company,
  Contact,
  Country,
  Lead,
  LeadSource,
  LeadStatus,
  NotificationPrefs,
  Priority,
  Qualification,
  Task,
  TaskType,
  ActivityType,
} from "@/lib/types";

/** Display name -> row id for the workspace's members and lead sources. */
export interface Directory {
  /** profile full_name -> workspace_members.id */
  membersByName: Map<string, string>;
  /** lead_sources.name -> lead_sources.id */
  sourcesByName: Map<string, string>;
}

export const EMPTY_DIRECTORY: Directory = {
  membersByName: new Map(),
  sourcesByName: new Map(),
};

// --- outbound (row -> UI) -------------------------------------------------
// PostgREST embeds joins as nested objects, e.g.
//   owner: { profile: { full_name: "A. Rivera" } }   (or null when unassigned)
//   source: { name: "Referral" }                     (or null when source deleted)
// so those two are unwrapped here; everything else is a flat column.

const asStr = (v: unknown): string => (v == null ? "" : String(v));
const asNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Postgres `date` arrives as "YYYY-MM-DD"; the UI uses "" for "no date". */
const asDate = (v: unknown): string => (v == null ? "" : String(v));

/** `{ profile: { full_name } }` | null -> display name ("" = Unassigned). */
export function ownerName(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const profile = (v as { profile?: { full_name?: unknown } | null }).profile;
  return profile ? asStr(profile.full_name) : "";
}

/** `{ name }` | null -> source literal ("" when the source row was deleted). */
export function sourceName(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  return asStr((v as { name?: unknown }).name);
}

export function rowToLead(r: Record<string, unknown>): Lead {
  return {
    id: asStr(r.id),
    company: asStr(r.company_name),
    contact: asStr(r.contact_name),
    email: asStr(r.email),
    phone: asStr(r.phone),
    source: sourceName(r.source) as LeadSource,
    status: asStr(r.status) as LeadStatus,
    score: asNum(r.score),
    fitScore: asNum(r.fit_score),
    businessType: asStr(r.business_type) as BusinessType,
    value: asNum(r.value),
    owner: ownerName(r.owner),
    lastContact: asDate(r.last_contact),
    nextFollowUp: asDate(r.next_follow_up),
    evidence: asStr(r.evidence),
    followUpEvidence: asStr(r.follow_up_evidence),
    qualification: asStr(r.qualification) as Qualification,
    recommendedAction: asStr(r.recommended_action),
    cadencePaused: r.cadence_paused === true,
  };
}

export function rowToCompany(r: Record<string, unknown>): Company {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    businessType: asStr(r.business_type) as BusinessType,
    city: asStr(r.city),
    region: asStr(r.region),
    country: asStr(r.country) as Country,
    website: asStr(r.website),
    email: asStr(r.email),
    phone: asStr(r.phone),
    fitScore: asNum(r.fit_score),
    owner: ownerName(r.owner),
    notes: asStr(r.notes),
    instagramUrl: asStr(r.instagram_url),
    facebookUrl: asStr(r.facebook_url),
    linkedinUrl: asStr(r.linkedin_url),
    perfectClientUrl: asStr(r.perfect_client_url),
  };
}

export function rowToContact(r: Record<string, unknown>): Contact {
  const company = r.company && typeof r.company === "object"
    ? asStr((r.company as { name?: unknown }).name)
    : "";
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    company,
    title: asStr(r.title),
    email: asStr(r.email),
    phone: asStr(r.phone),
    owner: ownerName(r.owner),
    linkedinUrl: asStr(r.linkedin_url),
    instagramUrl: asStr(r.instagram_url),
    facebookUrl: asStr(r.facebook_url),
  };
}

export function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: asStr(r.id),
    title: asStr(r.title),
    dueDate: asDate(r.due_date),
    priority: asStr(r.priority) as Priority,
    type: asStr(r.type) as TaskType,
    done: r.is_done === true,
    relatedTo: asStr(r.related_to),
    cancelledAt: r.cancelled_at == null ? null : asStr(r.cancelled_at),
  };
}

export function rowToActivity(r: Record<string, unknown>): Activity {
  return {
    id: asStr(r.id),
    type: asStr(r.type) as ActivityType,
    subject: asStr(r.subject),
    date: asDate(r.occurred_at),
    owner: ownerName(r.owner),
    relatedTo: asStr(r.related_to),
  };
}

// --- notification prefs (Settings → Notifications) -------------------------
// Decision §5.3: four typed boolean columns on `profiles`, no jsonb. These
// two pure functions are the whole translation layer, so a column rename
// touches one place (and one test), not the Settings page.

export function rowToNotificationPrefs(r: Record<string, unknown>): NotificationPrefs {
  // Only a signed-in user can read their own profile row (RLS), and the
  // columns are NOT NULL, so anything non-boolean here means a schema/probe
  // mismatch — fall back to the shipped defaults rather than render garbage.
  // Literals, not DEFAULT_NOTIFICATION_PREFS: this module must stay
  // importable by `node --test`, which resolves neither the `@/` alias nor
  // extensionless relatives. tests/b2-mapping.test.ts pins these to
  // DEFAULT_NOTIFICATION_PREFS so they cannot drift.
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  return {
    newLeadAlerts: bool(r.new_lead_alerts, true),
    dailyDigest: bool(r.daily_digest, true),
    overdueReminders: bool(r.overdue_reminders, true),
    weeklyReport: bool(r.weekly_report, false),
  };
}

export function notificationPrefsToRow(
  prefs: NotificationPrefs,
): Record<string, unknown> {
  return {
    new_lead_alerts: prefs.newLeadAlerts,
    daily_digest: prefs.dailyDigest,
    overdue_reminders: prefs.overdueReminders,
    weekly_report: prefs.weeklyReport,
  };
}

// --- inbound (UI -> insert payload) --------------------------------------
// Deliberately omits workspace_id, owner_id and every id the DB generates:
// the caller adds workspace_id, and owner_id/source_id come from the
// Directory. An owner name that matches no live member resolves to null
// ("Unassigned"), which is the correct, non-destructive outcome when the
// workspace has fewer members than the mock OWNERS list.

export function leadToRow(
  lead: Omit<Lead, "id">,
  dir: Directory,
): Record<string, unknown> {
  return {
    company_name: lead.company,
    contact_name: lead.contact,
    email: lead.email || null,
    phone: lead.phone || null,
    source_id: dir.sourcesByName.get(lead.source) ?? null,
    status: lead.status,
    business_type: lead.businessType,
    value: lead.value,
    score: lead.score,
    fit_score: lead.fitScore,
    qualification: lead.qualification,
    evidence: lead.evidence,
    follow_up_evidence: lead.followUpEvidence,
    recommended_action: lead.recommendedAction,
    owner_id: dir.membersByName.get(lead.owner) ?? null,
    last_contact: lead.lastContact || null,
    next_follow_up: lead.nextFollowUp || null,
    cadence_paused: lead.cadencePaused,
  };
}

export function companyToRow(
  company: Omit<Company, "id">,
  dir: Directory,
): Record<string, unknown> {
  return {
    name: company.name,
    business_type: company.businessType,
    city: company.city || null,
    region: company.region || null,
    country: company.country,
    website: company.website || null,
    email: company.email || null,
    phone: company.phone || null,
    fit_score: company.fitScore,
    notes: company.notes,
    owner_id: dir.membersByName.get(company.owner) ?? null,
    instagram_url: company.instagramUrl || null,
    facebook_url: company.facebookUrl || null,
    linkedin_url: company.linkedinUrl || null,
    perfect_client_url: company.perfectClientUrl || null,
  };
}

export function contactToRow(
  contact: Omit<Contact, "id">,
  companyIdsByName: Map<string, string>,
  dir: Directory,
): Record<string, unknown> {
  return {
    name: contact.name,
    company_id: companyIdsByName.get(contact.company) ?? null,
    title: contact.title,
    email: contact.email || null,
    phone: contact.phone || null,
    owner_id: dir.membersByName.get(contact.owner) ?? null,
    linkedin_url: contact.linkedinUrl || null,
    instagram_url: contact.instagramUrl || null,
    facebook_url: contact.facebookUrl || null,
  };
}

export function taskToRow(task: Omit<Task, "id">): Record<string, unknown> {
  return {
    title: task.title,
    due_date: task.dueDate || null,
    priority: task.priority,
    type: task.type,
    is_done: task.done,
    related_to: task.relatedTo,
    completed_at: task.done ? new Date().toISOString() : null,
    cancelled_at: task.cancelledAt || null,
  };
}

export function activityToRow(
  activity: Omit<Activity, "id">,
  dir: Directory,
): Record<string, unknown> {
  return {
    type: activity.type,
    subject: activity.subject,
    body: "",
    occurred_at: activity.date,
    related_to: activity.relatedTo,
    owner_id: dir.membersByName.get(activity.owner) ?? null,
  };
}

// --- partial updates ------------------------------------------------------
// The *_ToRow helpers above return a COMPLETE insert payload. Sending that
// wholesale on an update would overwrite every column the caller did not
// mention with the blank's default. These maps translate a camelCase UI key
// to the snake_case column so `pickPatch` can keep only the columns the
// caller actually set. `workspace_id` is deliberately absent: it is never
// user-editable.

const LEAD_UI_TO_DB: Record<string, string> = {
  company: "company_name",
  contact: "contact_name",
  email: "email",
  phone: "phone",
  source: "source_id",
  status: "status",
  score: "score",
  fitScore: "fit_score",
  businessType: "business_type",
  value: "value",
  owner: "owner_id",
  lastContact: "last_contact",
  nextFollowUp: "next_follow_up",
  evidence: "evidence",
  followUpEvidence: "follow_up_evidence",
  qualification: "qualification",
  recommendedAction: "recommended_action",
  cadencePaused: "cadence_paused",
};

const COMPANY_UI_TO_DB: Record<string, string> = {
  name: "name",
  businessType: "business_type",
  city: "city",
  region: "region",
  country: "country",
  website: "website",
  email: "email",
  phone: "phone",
  fitScore: "fit_score",
  notes: "notes",
  owner: "owner_id",
  instagramUrl: "instagram_url",
  facebookUrl: "facebook_url",
  linkedinUrl: "linkedin_url",
  perfectClientUrl: "perfect_client_url",
};

const CONTACT_UI_TO_DB: Record<string, string> = {
  name: "name",
  company: "company_id",
  title: "title",
  email: "email",
  phone: "phone",
  owner: "owner_id",
  linkedinUrl: "linkedin_url",
  instagramUrl: "instagram_url",
  facebookUrl: "facebook_url",
};

/**
 * Build a partial-update payload from a patch.
 *
 * Takes the blank entity, the caller's patch and the entity's row builder, so
 * the blank+patch merge happens HERE rather than at every call site. That
 * removes a real footgun: if a caller passed a row built from the *original*
 * entity, the update would silently persist stale values.
 *
 * Only columns whose UI key appears in `patch` are sent, so an update never
 * overwrites a field the caller did not mention. `undefined` means "not set"
 * and is dropped; `null`/`""` are real values and are kept, so clearing a
 * field still persists.
 */
export function patchRow<T extends object>(
  blank: T,
  patch: Partial<T>,
  toRow: (entity: T) => Record<string, unknown>,
  uiToDb: Record<string, string>,
): Record<string, unknown> {
  const full = toRow({ ...blank, ...patch });
  const out: Record<string, unknown> = {};
  for (const [uiKey, dbKey] of Object.entries(uiToDb)) {
    if (patch[uiKey as keyof T] !== undefined) out[dbKey] = full[dbKey];
  }
  return out;
}

export const LEAD_PATCH_KEYS = LEAD_UI_TO_DB;
export const COMPANY_PATCH_KEYS = COMPANY_UI_TO_DB;
export const CONTACT_PATCH_KEYS = CONTACT_UI_TO_DB;
