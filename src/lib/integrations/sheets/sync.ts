// Server-side Google Sheets sync engine.
//
// Called by the authenticated API routes and by the cron route. The caller
// supplies a Supabase client (user session for manual runs, service role for
// scheduled runs) and a workspace id that has ALREADY been authorisation-
// checked. Every query below is additionally scoped with `.eq("workspace_id")`
// so a mistake upstream cannot cross tenant boundaries.
//
// Safety rules implemented here:
//   * dry-run is the default; apply only runs when explicitly requested,
//   * stable `sync_key` identity (never row numbers),
//   * updates send ONLY cells that were non-blank in the sheet,
//   * blank cells never erase CRM values,
//   * owner values that do not match a workspace member are ignored on update,
//   * every run (dry or applied) is written to `sheet_sync_runs`,
//   * applied runs also write a `lead_imports` audit row.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSyncPlan,
  mapRows,
  type ExistingSnapshot,
  type MapRowsResult,
  type MappedRow,
  type SyncPlan,
} from "./model";
import { readSheet, sheetsConfig, type SheetsConfig } from "./google";

type Row = Record<string, unknown>;

export interface SyncOptions {
  db: SupabaseClient;
  workspaceId: string;
  /** workspace_members.id of the signed-in user, or null for cron. */
  actorMemberId: string | null;
  mode: "dry_run" | "apply";
  triggeredBy: "manual" | "scheduled" | "api";
  config?: Partial<SheetsConfig>;
  /** Exact header text -> field overrides from the connection config. */
  columnMap?: Record<string, string>;
  connectionId?: string | null;
}

export interface SyncReport {
  runId: string;
  mode: "dry_run" | "apply";
  status: "completed" | "partial" | "failed";
  spreadsheetTitle: string;
  tab: string;
  counts: SyncPlan["counts"];
  invalid: SyncPlan["invalid"];
  duplicates: SyncPlan["duplicates"];
  headers: Record<string, string>;
  unmappedHeaders: string[];
  missingFields: string[];
  rows: {
    line: number;
    company: string;
    contact: string;
    email: string;
    companyAction: string;
    contactAction: string | null;
    leadAction: string;
    warnings: string[];
  }[];
  errors: { line: number; message: string }[];
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string;
}

const asRows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);
const asStr = (value: unknown): string => (value == null ? "" : String(value));

async function startRun(
  db: SupabaseClient,
  options: SyncOptions,
): Promise<string> {
  const { data, error } = await db
    .from("sheet_sync_runs")
    .insert({
      workspace_id: options.workspaceId,
      connection_id: options.connectionId ?? null,
      mode: options.mode,
      triggered_by: options.triggeredBy,
      status: "running",
      created_by: options.actorMemberId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`startRun: ${error.message}`);
  return asStr((data as Row).id);
}

async function finishRun(
  db: SupabaseClient,
  runId: string,
  patch: Row,
): Promise<void> {
  const { error } = await db
    .from("sheet_sync_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("[sheets] could not finalise sync run", error.message);
}

async function loadExisting(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ExistingSnapshot> {
  const [companies, contacts, leads] = await Promise.all([
    db
      .from("companies")
      .select("id, name, sync_key")
      .eq("workspace_id", workspaceId),
    db
      .from("contacts")
      .select("id, name, email, sync_key, company:companies(name)")
      .eq("workspace_id", workspaceId),
    db
      .from("leads")
      .select("id, company_name, contact_name, email, sync_key")
      .eq("workspace_id", workspaceId),
  ]);
  if (companies.error) throw new Error(`loadExisting companies: ${companies.error.message}`);
  if (contacts.error) throw new Error(`loadExisting contacts: ${contacts.error.message}`);
  if (leads.error) throw new Error(`loadExisting leads: ${leads.error.message}`);

  return {
    companies: asRows(companies.data).map((r) => ({
      id: asStr(r.id),
      name: asStr(r.name),
      sync_key: r.sync_key == null ? null : asStr(r.sync_key),
    })),
    contacts: asRows(contacts.data).map((r) => ({
      id: asStr(r.id),
      name: asStr(r.name),
      email: r.email == null ? null : asStr(r.email),
      sync_key: r.sync_key == null ? null : asStr(r.sync_key),
      companyName:
        r.company && typeof r.company === "object"
          ? asStr((r.company as { name?: unknown }).name)
          : "",
    })),
    leads: asRows(leads.data).map((r) => ({
      id: asStr(r.id),
      company: asStr(r.company_name),
      contact: asStr(r.contact_name),
      email: r.email == null ? null : asStr(r.email),
      sync_key: r.sync_key == null ? null : asStr(r.sync_key),
    })),
  };
}

async function loadMemberIds(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("workspace_members")
    .select("id, profile:profiles(full_name)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`loadMemberIds: ${error.message}`);
  const map = new Map<string, string>();
  for (const member of asRows(data)) {
    const name =
      member.profile && typeof member.profile === "object"
        ? asStr((member.profile as { full_name?: unknown }).full_name)
        : "";
    if (name) map.set(name, asStr(member.id));
  }
  return map;
}

async function ensureSource(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("lead_sources")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", "Google Sheets")
    .maybeSingle();
  if (error) throw new Error(`ensureSource read: ${error.message}`);
  if (data) return asStr((data as Row).id);

  const { data: inserted, error: insertError } = await db
    .from("lead_sources")
    .insert({ workspace_id: workspaceId, name: "Google Sheets", is_system: true })
    .select("id")
    .single();
  if (insertError) {
    // A concurrent sync may have created it between the read and insert.
    const { data: retry } = await db
      .from("lead_sources")
      .select("id")
      .eq("workspace_id", workspaceId)
      .ilike("name", "Google Sheets")
      .maybeSingle();
    if (retry) return asStr((retry as Row).id);
    throw new Error(`ensureSource insert: ${insertError.message}`);
  }
  return asStr((inserted as Row).id);
}

// --- apply helpers ---------------------------------------------------------

function companyPayload(
  row: MappedRow,
  workspaceId: string,
  memberIds: Map<string, string>,
  mode: "insert" | "update",
): Row {
  const p = row.present;
  const ownerId = p["company.owner"] ? memberIds.get(row.company.owner) : undefined;
  const payload: Row = { sync_key: row.companyKey };
  if (mode === "insert") {
    payload.workspace_id = workspaceId;
    payload.name = row.company.name;
    payload.business_type = row.company.businessType;
    payload.country = row.company.country;
    payload.city = row.company.city || null;
    payload.region = row.company.region || null;
    payload.website = row.company.website || null;
    payload.email = row.company.email || null;
    payload.phone = row.company.phone || null;
    payload.notes = row.company.notes;
    payload.instagram_url = row.company.instagramUrl || null;
    payload.facebook_url = row.company.facebookUrl || null;
    payload.linkedin_url = row.company.linkedinUrl || null;
    payload.perfect_client_url = row.company.perfectClientUrl || null;
    payload.owner_id = ownerId ?? null;
    return payload;
  }
  if (p["company.name"]) payload.name = row.company.name;
  if (p["company.businessType"]) payload.business_type = row.company.businessType;
  if (p["company.country"]) payload.country = row.company.country;
  if (p["company.city"]) payload.city = row.company.city;
  if (p["company.region"]) payload.region = row.company.region;
  if (p["company.website"]) payload.website = row.company.website;
  if (p["company.email"]) payload.email = row.company.email;
  if (p["company.phone"]) payload.phone = row.company.phone;
  if (p["company.notes"]) payload.notes = row.company.notes;
  if (p["company.instagramUrl"]) payload.instagram_url = row.company.instagramUrl;
  if (p["company.facebookUrl"]) payload.facebook_url = row.company.facebookUrl;
  if (p["company.linkedinUrl"]) payload.linkedin_url = row.company.linkedinUrl;
  if (p["company.perfectClientUrl"]) payload.perfect_client_url = row.company.perfectClientUrl;
  if (ownerId) payload.owner_id = ownerId;
  return payload;
}

function contactPayload(
  row: MappedRow,
  workspaceId: string,
  memberIds: Map<string, string>,
  companyId: string | null,
  mode: "insert" | "update",
): Row {
  const contact = row.contact;
  if (!contact) return {};
  const p = row.present;
  const ownerId = p["contact.owner"] ? memberIds.get(contact.owner) : undefined;
  const payload: Row = { sync_key: row.contactKey };
  if (mode === "insert") {
    payload.workspace_id = workspaceId;
    payload.name = contact.name;
    payload.company_id = companyId;
    payload.title = contact.title;
    payload.email = contact.email || null;
    payload.phone = contact.phone || null;
    payload.owner_id = ownerId ?? null;
    payload.linkedin_url = contact.linkedinUrl || null;
    payload.instagram_url = contact.instagramUrl || null;
    payload.facebook_url = contact.facebookUrl || null;
    return payload;
  }
  if (companyId) payload.company_id = companyId;
  if (p["contact.name"]) payload.name = contact.name;
  if (p["contact.title"]) payload.title = contact.title;
  if (p["contact.email"]) payload.email = contact.email;
  if (p["contact.phone"]) payload.phone = contact.phone;
  if (p["contact.linkedinUrl"]) payload.linkedin_url = contact.linkedinUrl;
  if (p["contact.instagramUrl"]) payload.instagram_url = contact.instagramUrl;
  if (p["contact.facebookUrl"]) payload.facebook_url = contact.facebookUrl;
  if (ownerId) payload.owner_id = ownerId;
  return payload;
}

function leadPayload(
  row: MappedRow,
  workspaceId: string,
  memberIds: Map<string, string>,
  sourceId: string | null,
  companyId: string | null,
  contactId: string | null,
  importId: string | null,
  actorMemberId: string | null,
  mode: "insert" | "update",
): Row {
  const lead = row.lead;
  const p = row.present;
  const ownerId = p["lead.owner"] ? memberIds.get(lead.owner) : undefined;
  const payload: Row = { sync_key: row.leadKey, company_name: lead.company };
  if (mode === "insert") {
    payload.workspace_id = workspaceId;
    payload.contact_name = lead.contact;
    payload.email = lead.email || null;
    payload.phone = lead.phone || null;
    payload.source_id = sourceId;
    payload.status = lead.status;
    payload.business_type = lead.businessType;
    payload.value = lead.value;
    payload.score = lead.score;
    payload.fit_score = lead.fitScore;
    payload.qualification = lead.qualification;
    payload.evidence = lead.evidence;
    payload.follow_up_evidence = lead.followUpEvidence;
    payload.recommended_action = lead.recommendedAction;
    payload.owner_id = ownerId ?? null;
    payload.last_contact = lead.lastContact || null;
    payload.next_follow_up = lead.nextFollowUp || null;
    payload.company_id = companyId;
    payload.contact_id = contactId;
    payload.import_id = importId;
    payload.created_by = actorMemberId;
    return payload;
  }
  if (companyId) payload.company_id = companyId;
  if (contactId) payload.contact_id = contactId;
  if (p["lead.contact"]) payload.contact_name = lead.contact;
  if (p["lead.email"]) payload.email = lead.email;
  if (p["lead.phone"]) payload.phone = lead.phone;
  if (sourceId) payload.source_id = sourceId;
  if (p["lead.status"]) payload.status = lead.status;
  if (p["lead.businessType"]) payload.business_type = lead.businessType;
  if (p["lead.value"]) payload.value = lead.value;
  if (p["lead.score"]) payload.score = lead.score;
  if (p["lead.fitScore"]) payload.fit_score = lead.fitScore;
  if (p["lead.qualification"]) payload.qualification = lead.qualification;
  if (p["lead.evidence"]) payload.evidence = lead.evidence;
  if (p["lead.recommendedAction"]) payload.recommended_action = lead.recommendedAction;
  if (ownerId) payload.owner_id = ownerId;
  if (p["lead.lastContact"]) payload.last_contact = lead.lastContact;
  if (p["lead.nextFollowUp"]) payload.next_follow_up = lead.nextFollowUp;
  return payload;
}

/** Insert, falling back to an update when a unique index wins a race. */
async function upsert(
  db: SupabaseClient,
  table: "companies" | "contacts" | "leads",
  id: string | null,
  payload: Row,
  workspaceId: string,
  conflictColumn: "name" | "email" | "sync_key",
  conflictValue: string,
): Promise<string> {
  if (id) {
    const { error } = await db
      .from(table)
      .update(payload)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`${table} update: ${error.message}`);
    return id;
  }
  const { data, error } = await db
    .from(table)
    .insert(payload)
    .select("id")
    .single();
  if (!error) return asStr((data as Row).id);

  if (/duplicate key|unique constraint/i.test(error.message)) {
    const lookup = db
      .from(table)
      .select("id")
      .eq("workspace_id", workspaceId);
    const { data: found, error: findError } =
      conflictColumn === "sync_key"
        ? await lookup.eq("sync_key", conflictValue).maybeSingle()
        : await lookup.ilike(conflictColumn, conflictValue).maybeSingle();
    if (!findError && found) {
      const foundId = asStr((found as Row).id);
      const { error: updateError } = await db
        .from(table)
        .update(payload)
        .eq("id", foundId)
        .eq("workspace_id", workspaceId);
      if (updateError) throw new Error(`${table} update after conflict: ${updateError.message}`);
      return foundId;
    }
  }
  throw new Error(`${table} insert: ${error.message}`);
}

// --- entry point -----------------------------------------------------------

export async function runSheetSync(options: SyncOptions): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  const runId = await startRun(options.db, options);
  const config = sheetsConfig(options.config);

  let sheetTitle = "";
  let tab = config.tab;
  let mapped: MapRowsResult;
  let plan: SyncPlan;

  try {
    const sheet = await readSheet(config);
    sheetTitle = sheet.spreadsheetTitle;
    tab = sheet.tab;
    const result = mapRows(sheet.values, { columnMap: options.columnMap });
    if ("error" in result) {
      throw new Error(result.error);
    }
    mapped = result;
    plan = buildSyncPlan(mapped, await loadExisting(options.db, options.workspaceId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(options.db, runId, {
      status: "failed",
      sheet_title: sheetTitle || null,
      error_summary: message.slice(0, 2000),
      report: { mode: options.mode, error: message.slice(0, 2000) },
    });
    await markConnection(options.db, options, "failed", message);
    return {
      runId,
      mode: options.mode,
      status: "failed",
      spreadsheetTitle: sheetTitle,
      tab,
      counts: {
        totalRows: 0,
        companies: { create: 0, update: 0, skip: 0 },
        contacts: { create: 0, update: 0, skip: 0 },
        leads: { create: 0, update: 0, skip: 0 },
        skippedRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
      },
      invalid: [],
      duplicates: [],
      headers: {},
      unmappedHeaders: [],
      missingFields: [],
      rows: [],
      errors: [],
      errorSummary: message,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const rowsByLine = new Map(mapped.rows.map((row) => [row.line, row]));
  const errors: { line: number; message: string }[] = [];
  const counts = structuredClone(plan.counts);
  const companyIdsByKey = new Map<string, string>();
  const contactIdsByKey = new Map<string, string>();

  if (options.mode === "apply") {
    const memberIds = await loadMemberIds(options.db, options.workspaceId);
    const sourceId = await ensureSource(options.db, options.workspaceId);

    const { data: importRow, error: importError } = await options.db
      .from("lead_imports")
      .insert({
        workspace_id: options.workspaceId,
        source_name: "Google Sheets",
        file_name: `${sheetTitle || "Google Sheet"} / ${tab}`,
        status: "processing",
        total_rows: counts.totalRows,
        imported_by: options.actorMemberId,
      })
      .select("id")
      .single();
    if (importError) throw new Error(`lead_imports insert: ${importError.message}`);
    const importId = asStr((importRow as Row).id);

    // Reset actual counters; planned counts are not trusted after writes fail.
    counts.companies = { create: 0, update: 0, skip: 0 };
    counts.contacts = { create: 0, update: 0, skip: 0 };
    counts.leads = { create: 0, update: 0, skip: 0 };
    counts.skippedRows = 0;
    counts.duplicateRows = 0;

    for (const rowPlan of plan.rows) {
      const row = rowsByLine.get(rowPlan.line);
      if (!row) continue;

      let companyId: string | null =
        companyIdsByKey.get(row.companyKey) ?? rowPlan.company.matchId;
      try {
        if (rowPlan.company.action !== "skip") {
          companyId = await upsert(
            options.db,
            "companies",
            rowPlan.company.matchId,
            companyPayload(row, options.workspaceId, memberIds, rowPlan.company.action === "update" ? "update" : "insert"),
            options.workspaceId,
            "name",
            row.company.name,
          );
          counts.companies[rowPlan.company.action === "update" ? "update" : "create"]++;
        }
        if (companyId) companyIdsByKey.set(row.companyKey, companyId);
      } catch (error) {
        errors.push({ line: rowPlan.line, message: `Company: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }

      let contactId: string | null =
        (row.contactKey ? contactIdsByKey.get(row.contactKey) : undefined) ??
        rowPlan.contact?.matchId ??
        null;
      if (row.contact && rowPlan.contact && rowPlan.contact.action !== "skip") {
        try {
          contactId = await upsert(
            options.db,
            "contacts",
            rowPlan.contact.matchId,
            contactPayload(row, options.workspaceId, memberIds, companyId, rowPlan.contact.action === "update" ? "update" : "insert"),
            options.workspaceId,
            row.contact.email ? "email" : "sync_key",
            row.contact.email || rowPlan.contact.key,
          );
          if (row.contactKey) contactIdsByKey.set(row.contactKey, contactId);
          counts.contacts[rowPlan.contact.action === "update" ? "update" : "create"]++;
        } catch (error) {
          errors.push({ line: rowPlan.line, message: `Contact: ${error instanceof Error ? error.message : String(error)}` });
        }
      } else if (rowPlan.contact?.action === "skip") {
        counts.contacts.skip++;
      }

      if (rowPlan.lead.action === "skip") {
        counts.leads.skip++;
        counts.duplicateRows++;
        continue;
      }
      try {
        await upsert(
          options.db,
          "leads",
          rowPlan.lead.matchId,
          leadPayload(
            row,
            options.workspaceId,
            memberIds,
            sourceId,
            companyId,
            contactId,
            importId,
            options.actorMemberId,
            rowPlan.lead.action === "update" ? "update" : "insert",
          ),
          options.workspaceId,
          "sync_key",
          rowPlan.lead.key,
        );
        counts.leads[rowPlan.lead.action === "update" ? "update" : "create"]++;
      } catch (error) {
        errors.push({ line: rowPlan.line, message: `Lead: ${error instanceof Error ? error.message : String(error)}` });
      }
    }

    const failedRows = new Set(errors.map((e) => e.line)).size;
    counts.skippedRows = counts.leads.skip;
    const status: "completed" | "partial" | "failed" =
      failedRows === 0 ? "completed" : failedRows >= counts.totalRows ? "failed" : "partial";

    await options.db
      .from("lead_imports")
      .update({
        status: status === "completed" ? "completed" : "failed",
        created_rows: counts.companies.create + counts.contacts.create + counts.leads.create,
        failed_rows: failedRows,
        error_summary: errors.length
          ? errors.slice(0, 50).map((e) => `Row ${e.line}: ${e.message}`).join(" | ").slice(0, 2000)
          : null,
      })
      .eq("id", importId)
      .eq("workspace_id", options.workspaceId);

    return finalise(status);
  }

  return finalise(plan.invalid.length > 0 ? "partial" : "completed");

  async function finalise(status: "completed" | "partial" | "failed"): Promise<SyncReport> {
    const finishedAt = new Date().toISOString();
    const errorSummary =
      errors.length > 0
        ? errors.slice(0, 50).map((e) => `Row ${e.line}: ${e.message}`).join(" | ")
        : plan.invalid.length > 0
          ? `${plan.invalid.length} invalid row(s) skipped.`
          : null;

    const report: SyncReport = {
      runId,
      mode: options.mode,
      status,
      spreadsheetTitle: sheetTitle,
      tab,
      counts,
      invalid: plan.invalid,
      duplicates: plan.duplicates,
      headers: plan.headers,
      unmappedHeaders: plan.unmappedHeaders,
      missingFields: plan.missingFields,
      rows: plan.rows.slice(0, 500).map((r) => ({
        line: r.line,
        company: r.companyName,
        contact: r.contactName,
        email: r.email,
        companyAction: r.company.action,
        contactAction: r.contact?.action ?? null,
        leadAction: r.lead.action,
        warnings: r.warnings,
      })),
      errors,
      errorSummary,
      startedAt,
      finishedAt,
    };

    await finishRun(options.db, runId, {
      status,
      sheet_title: sheetTitle || null,
      total_rows: counts.totalRows,
      companies_created: counts.companies.create,
      companies_updated: counts.companies.update,
      contacts_created: counts.contacts.create,
      contacts_updated: counts.contacts.update,
      leads_created: counts.leads.create,
      leads_updated: counts.leads.update,
      skipped_rows: counts.skippedRows,
      invalid_rows: counts.invalidRows,
      error_summary: errorSummary,
      report,
    });
    await markConnection(options.db, options, status === "failed" ? "failed" : status === "partial" ? "partial" : "ok", errorSummary);
    return report;
  }
}

async function markConnection(
  db: SupabaseClient,
  options: SyncOptions,
  status: "ok" | "partial" | "failed",
  error: string | null,
): Promise<void> {
  if (!options.connectionId) return;
  const { error: updateError } = await db
    .from("integration_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_status: status,
      last_error: error ? error.slice(0, 2000) : null,
    })
    .eq("id", options.connectionId)
    .eq("workspace_id", options.workspaceId);
  if (updateError) {
    console.error("[sheets] could not update connection status", updateError.message);
  }
}
