// Live data access for the CRM entities (B2).
//
// One module, explicit queries, no ORM. Every select string here was verified
// against a real local Supabase stack (see tests/b2-live-check.mjs): the
// B1 security remediation added a composite deferrable FK alongside each
// plain owner/assignee FK, so PostgREST refuses an unhinted
// `workspace_members` embed ("more than one relationship was found"). Each
// embed below therefore names its FK constraint explicitly.
//
// RLS scopes every query to the caller's workspace, so nothing here filters
// by workspace_id on read. Inserts DO set workspace_id, because the column is
// NOT NULL and RLS only checks it, it does not fill it in.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Activity,
  Company,
  Contact,
  Lead,
  LeadStatus,
  NotificationPrefs,
  Task,
} from "@/lib/types";
import {
  COMPANY_PATCH_KEYS,
  CONTACT_PATCH_KEYS,
  LEAD_PATCH_KEYS,
  activityToRow,
  companyToRow,
  contactToRow,
  leadToRow,
  notificationPrefsToRow,
  patchRow,
  rowToActivity,
  rowToCompany,
  rowToContact,
  rowToLead,
  rowToNotificationPrefs,
  rowToTask,
  taskToRow,
  type Directory,
} from "./mapping";

/** Same shape crm-store uses for create payloads. */
export type New<T> = Omit<T, "id">;

// Explicit FK hints: required because b1_security_remediation.sql added
// composite (workspace_id, owner_id) FKs next to the plain ones.
const LEAD_OWNER = "workspace_members!leads_owner_id_fkey";
const COMPANY_OWNER = "workspace_members!companies_owner_id_fkey";
const CONTACT_OWNER = "workspace_members!contacts_owner_id_fkey";
const ACTIVITY_OWNER = "workspace_members!activities_owner_id_fkey";

const ownerEmbed = (fk: string) => `${fk}(user_id, profile:profiles(full_name))`;

// NOTE: these select strings must stay on ONE line. supabase-js parses them
// at the type level, and its parser cannot handle the `!fk` embed hints below
// (it degrades to GenericStringError). They are therefore typed `any` here so
// the query result is untyped; the actual runtime shape is asserted by
// tests/b2-live-check.mjs against a real stack, and every mapper takes
// Record<string, unknown> so nothing unsafe escapes this module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LEAD_COLUMNS: any =
  "id, company_name, contact_name, email, phone, status, score, fit_score, " +
  "business_type, value, qualification, evidence, follow_up_evidence, " +
  "recommended_action, last_contact, next_follow_up, " +
  `source:lead_sources(name), owner:${ownerEmbed(LEAD_OWNER)}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPANY_COLUMNS: any =
  "id, name, business_type, city, region, country, website, email, phone, " +
  "fit_score, notes, instagram_url, facebook_url, linkedin_url, perfect_client_url, " +
  `owner:${ownerEmbed(COMPANY_OWNER)}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CONTACT_COLUMNS: any =
  "id, name, title, email, phone, linkedin_url, instagram_url, facebook_url, " +
  `company:companies(name), owner:${ownerEmbed(CONTACT_OWNER)}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TASK_COLUMNS: any =
  "id, title, due_date, priority, type, is_done, related_to";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACTIVITY_COLUMNS: any =
  `id, type, subject, occurred_at, related_to, owner:${ownerEmbed(ACTIVITY_OWNER)}`;

/** Resolved once per session; workspace_id is NOT NULL on every insert. */
export interface WorkspaceContext {
  workspaceId: string;
  directory: Directory;
}

export async function loadWorkspaceContext(
  db: SupabaseClient,
): Promise<WorkspaceContext> {
  const { data: ws, error: wsErr } = await db
    .from("workspaces")
    .select("id")
    .limit(1)
    .single();
  if (wsErr || !ws) {
    throw new Error(`loadWorkspaceContext: ${wsErr?.message ?? "no workspace"}`);
  }

  const { data: members, error: mErr } = await db
    .from("workspace_members")
    .select("id, profile:profiles(full_name)");
  if (mErr) throw new Error(`loadWorkspaceContext members: ${mErr.message}`);

  const { data: sources, error: sErr } = await db
    .from("lead_sources")
    .select("id, name");
  if (sErr) throw new Error(`loadWorkspaceContext sources: ${sErr.message}`);

  const membersByName = new Map<string, string>();
  for (const m of members ?? []) {
    const name = (m.profile as { full_name?: string } | null)?.full_name;
    if (name) membersByName.set(name, m.id as string);
  }
  const sourcesByName = new Map<string, string>();
  for (const s of sources ?? []) {
    sourcesByName.set(String(s.name), s.id as string);
  }

  return {
    workspaceId: ws.id as string,
    directory: { membersByName, sourcesByName },
  };
}

// --- reads -----------------------------------------------------------------
// supabase-js's type-level parser cannot follow the `!fk` embed hints above,
// so results arrive as GenericStringError-shaped generics. These two helpers
// are the single cast point: everything downstream works in plain Row.

type Row = Record<string, unknown>;
const asRows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const asRow = (d: unknown): Row => d as Row;

export async function loadLeads(db: SupabaseClient): Promise<Lead[]> {
  const { data, error } = await db.from("leads").select(LEAD_COLUMNS);
  if (error) throw new Error(`loadLeads: ${error.message}`);
  return asRows(data).map(rowToLead);
}

export async function loadCompanies(db: SupabaseClient): Promise<Company[]> {
  const { data, error } = await db.from("companies").select(COMPANY_COLUMNS);
  if (error) throw new Error(`loadCompanies: ${error.message}`);
  return asRows(data).map(rowToCompany);
}

export async function loadContacts(db: SupabaseClient): Promise<Contact[]> {
  const { data, error } = await db.from("contacts").select(CONTACT_COLUMNS);
  if (error) throw new Error(`loadContacts: ${error.message}`);
  return asRows(data).map(rowToContact);
}

export async function loadTasks(db: SupabaseClient): Promise<Task[]> {
  const { data, error } = await db.from("tasks").select(TASK_COLUMNS);
  if (error) throw new Error(`loadTasks: ${error.message}`);
  return asRows(data).map(rowToTask);
}

export async function loadActivities(db: SupabaseClient): Promise<Activity[]> {
  const { data, error } = await db.from("activities").select(ACTIVITY_COLUMNS);
  if (error) throw new Error(`loadActivities: ${error.message}`);
  return asRows(data).map(rowToActivity);
}

// --- writes ----------------------------------------------------------------
// Every insert returns the freshly-read row so the caller gets the same
// joined shape the reads produce, keeping UI state consistent between a
// create and the next full load.

export async function insertLead(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  lead: New<Lead>,
): Promise<Lead> {
  const { data, error } = await db
    .from("leads")
    .insert({ ...leadToRow(lead, ctx.directory), workspace_id: ctx.workspaceId })
    .select(LEAD_COLUMNS)
    .single();
  if (error) throw new Error(`insertLead: ${error.message}`);
  return rowToLead(asRow(data));
}

export async function updateLead(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  id: string,
  patch: Partial<Lead>,
): Promise<void> {
  const payload = patchRow(
    blankLead(),
    patch,
    (e) => leadToRow(e, ctx.directory),
    LEAD_PATCH_KEYS,
  );
  const { error } = await db.from("leads").update(payload).eq("id", id);
  if (error) throw new Error(`updateLead: ${error.message}`);
}

export async function insertCompany(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  company: New<Company>,
): Promise<Company> {
  const { data, error } = await db
    .from("companies")
    .insert({
      ...companyToRow(company, ctx.directory),
      workspace_id: ctx.workspaceId,
    })
    .select(COMPANY_COLUMNS)
    .single();
  if (error) throw new Error(`insertCompany: ${error.message}`);
  return rowToCompany(asRow(data));
}

export async function updateCompany(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  id: string,
  patch: Partial<Company>,
): Promise<void> {
  const payload = patchRow(
    blankCompany(),
    patch,
    (e) => companyToRow(e, ctx.directory),
    COMPANY_PATCH_KEYS,
  );
  const { error } = await db.from("companies").update(payload).eq("id", id);
  if (error) throw new Error(`updateCompany: ${error.message}`);
}

export async function insertContact(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  contact: New<Contact>,
  companyIdsByName: Map<string, string>,
): Promise<Contact> {
  const { data, error } = await db
    .from("contacts")
    .insert({
      ...contactToRow(contact, companyIdsByName, ctx.directory),
      workspace_id: ctx.workspaceId,
    })
    .select(CONTACT_COLUMNS)
    .single();
  if (error) throw new Error(`insertContact: ${error.message}`);
  return rowToContact(asRow(data));
}

export async function updateContact(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  id: string,
  patch: Partial<Contact>,
  companyIdsByName: Map<string, string>,
): Promise<void> {
  const payload = patchRow(
    blankContact(),
    patch,
    (e) => contactToRow(e, companyIdsByName, ctx.directory),
    CONTACT_PATCH_KEYS,
  );
  const { error } = await db.from("contacts").update(payload).eq("id", id);
  if (error) throw new Error(`updateContact: ${error.message}`);
}

export async function insertTask(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  task: New<Task>,
): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .insert({ ...taskToRow(task), workspace_id: ctx.workspaceId })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw new Error(`insertTask: ${error.message}`);
  return rowToTask(asRow(data));
}

export async function setTaskDone(
  db: SupabaseClient,
  id: string,
  done: boolean,
): Promise<void> {
  const { error } = await db
    .from("tasks")
    .update({
      is_done: done,
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`setTaskDone: ${error.message}`);
}

export async function insertActivity(
  db: SupabaseClient,
  ctx: WorkspaceContext,
  activity: New<Activity>,
): Promise<Activity> {
  const { data, error } = await db
    .from("activities")
    .insert({
      ...activityToRow(activity, ctx.directory),
      workspace_id: ctx.workspaceId,
    })
    .select(ACTIVITY_COLUMNS)
    .single();
  if (error) throw new Error(`insertActivity: ${error.message}`);
  return rowToActivity(asRow(data));
}

/** Status-only move; the DB trigger logs the score history row itself. */
export async function moveLead(
  db: SupabaseClient,
  id: string,
  status: LeadStatus,
  lastContact: string,
): Promise<void> {
  const { error } = await db
    .from("leads")
    .update({ status, last_contact: lastContact || null })
    .eq("id", id);
  if (error) throw new Error(`moveLead: ${error.message}`);
}

export async function removeRow(
  db: SupabaseClient,
  table: "leads" | "companies" | "contacts" | "tasks" | "activities",
  id: string,
): Promise<void> {
  const { error } = await db.from(table).delete().eq("id", id);
  if (error) throw new Error(`removeRow(${table}): ${error.message}`);
}

// --- notification prefs (Settings → Notifications) -------------------------
// profiles.id IS auth.users.id, and `profiles_update` RLS allows only the
// row owner, so both functions take the signed-in user's id explicitly —
// never a workspace member id (that would silently read someone else's row
// when RLS permits co-member reads).

const PREF_COLUMNS = "new_lead_alerts, daily_digest, overdue_reminders, weekly_report";

export async function loadNotificationPrefs(
  db: SupabaseClient,
  userId: string,
): Promise<NotificationPrefs> {
  const { data, error } = await db
    .from("profiles")
    .select(PREF_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`loadNotificationPrefs: ${error.message}`);
  // No row (signed out mid-flight, or bootstrap race) → shipped defaults.
  return rowToNotificationPrefs((data as Record<string, unknown>) ?? {});
}

export async function saveNotificationPrefs(
  db: SupabaseClient,
  userId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  const { error } = await db
    .from("profiles")
    .update(notificationPrefsToRow(prefs))
    .eq("id", userId);
  if (error) throw new Error(`saveNotificationPrefs: ${error.message}`);
}

// --- blanks ---------------------------------------------------------------
// Partial updates must not wipe columns the patch does not mention, so an
// update builds its payload from a blank row merged with the patch and then
// sends ONLY the keys the patch actually set.

function blankLead(): New<Lead> {
  return {
    company: "",
    contact: "",
    email: "",
    phone: "",
    source: "Website",
    status: "new",
    score: 0,
    fitScore: 0,
    businessType: "Seller",
    value: 0,
    owner: "",
    lastContact: "",
    nextFollowUp: "",
    evidence: "",
    followUpEvidence: "",
    qualification: "Pending",
    recommendedAction: "",
  };
}

function blankCompany(): New<Company> {
  return {
    name: "",
    businessType: "Seller",
    city: "",
    region: "",
    country: "USA",
    website: "",
    email: "",
    phone: "",
    fitScore: 0,
    owner: "",
    notes: "",
    instagramUrl: "",
    facebookUrl: "",
    linkedinUrl: "",
    perfectClientUrl: "",
  };
}

function blankContact(): New<Contact> {
  return {
    name: "",
    company: "",
    title: "",
    email: "",
    phone: "",
    owner: "",
    linkedinUrl: "",
    instagramUrl: "",
    facebookUrl: "",
  };
}
