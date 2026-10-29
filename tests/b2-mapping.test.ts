import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_DIRECTORY,
  activityToRow,
  companyToRow,
  contactToRow,
  leadToRow,
  notificationPrefsToRow,
  ownerName,
  patchRow,
  rowToActivity,
  rowToContact,
  rowToLead,
  rowToNotificationPrefs,
  rowToTask,
  sourceName,
  taskToRow,
  LEAD_PATCH_KEYS,
  type Directory,
} from "../src/lib/supabase/mapping.ts";

import type { LeadStatus } from "../src/lib/types.ts";
import { DEFAULT_NOTIFICATION_PREFS } from "../src/lib/types.ts";

const DIR: Directory = {
  membersByName: new Map([
    ["A. Rivera", "mem-1"],
    ["J. Chen", "mem-2"],
  ]),
  sourcesByName: new Map([
    ["Referral", "src-2"],
    ["Website", "src-1"],
  ]),
};

// --- joined shapes from PostgREST -----------------------------------------

test("rowToLead unwraps the owner and source joins", () => {
  const lead = rowToLead({
    id: "l1",
    company_name: "Apex Indoor Golf",
    contact_name: "Dana Reyes",
    email: "dana@apexindoor.example",
    phone: "+1 303 555 0142",
    status: "qualified",
    score: 88,
    fit_score: 91,
    business_type: "Both",
    value: 42000,
    qualification: "Qualified",
    evidence: "Two bays",
    follow_up_evidence: "",
    recommended_action: "Send financing",
    last_contact: "2026-10-20",
    next_follow_up: "2026-11-02",
    source: { name: "Referral" },
    owner: { user_id: "mem-1", profile: { full_name: "A. Rivera" } },
  });

  assert.equal(lead.owner, "A. Rivera");
  assert.equal(lead.source, "Referral");
  assert.equal(lead.company, "Apex Indoor Golf");
  assert.equal(lead.value, 42000);
  assert.equal(lead.nextFollowUp, "2026-11-02");
});

test("rowToLead renders an unassigned owner as empty string", () => {
  const lead = rowToLead({ id: "l2", owner: null, source: null });
  assert.equal(lead.owner, "");
  assert.equal(lead.source, "");
});

test("rowToLead coerces NULL scores and dates to UI-safe values", () => {
  const lead = rowToLead({ id: "l3", score: null, fit_score: null, value: null, last_contact: null, next_follow_up: null });
  assert.equal(lead.score, 0);
  assert.equal(lead.fitScore, 0);
  assert.equal(lead.value, 0);
  assert.equal(lead.lastContact, "");
  assert.equal(lead.nextFollowUp, "");
});

test("rowToContact unwraps the company join", () => {
  const contact = rowToContact({
    id: "c1",
    name: "Dana Reyes",
    title: "Ops lead",
    email: "dana@apexindoor.example",
    phone: "",
    company: { name: "Apex Indoor Golf" },
    owner: { profile: { full_name: "J. Chen" } },
  });
  assert.equal(contact.company, "Apex Indoor Golf");
  assert.equal(contact.owner, "J. Chen");
});

test("rowToContact tolerates a deleted parent company", () => {
  const contact = rowToContact({ id: "c2", company: null, owner: null });
  assert.equal(contact.company, "");
  assert.equal(contact.owner, "");
});

test("rowToTask reads is_done and keeps free-text related_to", () => {
  const task = rowToTask({
    id: "t1",
    title: "Send one-pager",
    due_date: "2026-11-02",
    priority: "high",
    type: "follow-up",
    is_done: false,
    related_to: "Apex Indoor Golf",
  });
  assert.equal(task.done, false);
  assert.equal(task.relatedTo, "Apex Indoor Golf");
  assert.equal(task.dueDate, "2026-11-02");
});

test("rowToActivity converts occurred_at to the UI date field", () => {
  const act = rowToActivity({
    id: "a1",
    type: "call",
    subject: "Intro call",
    occurred_at: "2026-10-26T09:00:00+00:00",
    related_to: "Dana Reyes",
    owner: { profile: { full_name: "A. Rivera" } },
  });
  assert.equal(act.date, "2026-10-26T09:00:00+00:00");
  assert.equal(act.owner, "A. Rivera");
  assert.equal(act.relatedTo, "Dana Reyes");
});

// --- join helpers ---------------------------------------------------------

test("ownerName and sourceName are null-safe", () => {
  assert.equal(ownerName(null), "");
  assert.equal(ownerName(undefined), "");
  assert.equal(ownerName("nonsense"), "");
  assert.equal(sourceName(null), "");
  assert.equal(sourceName({ name: "Partner" }), "Partner");
});

// --- inbound payloads -----------------------------------------------------

test("leadToRow resolves owner and source names to ids", () => {
  const row = leadToRow(
    {
      company: "Apex Indoor Golf",
      contact: "Dana Reyes",
      email: "dana@apexindoor.example",
      phone: "",
      source: "Referral",
      status: "new",
      score: 88,
      fitScore: 91,
      businessType: "Both",
      value: 42000,
      owner: "A. Rivera",
      lastContact: "",
      nextFollowUp: "2026-11-02",
      evidence: "Two bays",
      followUpEvidence: "",
      qualification: "Qualified",
      recommendedAction: "Send financing",
    },
    DIR,
  );

  assert.equal(row.owner_id, "mem-1");
  assert.equal(row.source_id, "src-2");
  assert.equal(row.company_name, "Apex Indoor Golf");
  assert.equal(row.next_follow_up, "2026-11-02");
});

test("leadToRow nulls an owner or source the workspace does not have", () => {
  // A fresh workspace has one member, so the mock OWNERS list legitimately
  // contains names that resolve to nothing -> "Unassigned", not a crash.
  const row = leadToRow(
    {
      company: "X",
      contact: "",
      email: "",
      phone: "",
      source: "Trade show",
      status: "new",
      score: 0,
      fitScore: 0,
      businessType: "Seller",
      value: 0,
      owner: "C. Navarro",
      lastContact: "",
      nextFollowUp: "",
      evidence: "",
      followUpEvidence: "",
      qualification: "Pending",
      recommendedAction: "",
    },
    EMPTY_DIRECTORY,
  );
  assert.equal(row.owner_id, null);
  assert.equal(row.source_id, null);
});

test("leadToRow stores empty dates as NULL, not empty string", () => {
  const row = leadToRow(
    {
      company: "X",
      contact: "",
      email: "",
      phone: "",
      source: "Website",
      status: "lost",
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
    },
    DIR,
  );
  assert.equal(row.last_contact, null);
  assert.equal(row.next_follow_up, null);
});

test("companyToRow maps camelCase to snake_case and resolves owner", () => {
  const row = companyToRow(
    {
      name: "Apex Indoor Golf",
      businessType: "Both",
      city: "Denver",
      region: "CO",
      country: "USA",
      website: "apexindoor.example",
      email: "",
      phone: "+1 303 555 0142",
      fitScore: 91,
      owner: "J. Chen",
      notes: "Two bays",
    },
    DIR,
  );
  assert.equal(row.business_type, "Both");
  assert.equal(row.fit_score, 91);
  assert.equal(row.owner_id, "mem-2");
  assert.equal(row.email, null, "empty string becomes NULL");
});

test("contactToRow resolves the company display name to a company id", () => {
  const companyIds = new Map([["Apex Indoor Golf", "co-1"]]);
  const row = contactToRow(
    {
      name: "Dana Reyes",
      company: "Apex Indoor Golf",
      title: "Ops",
      email: "dana@apexindoor.example",
      phone: "",
      owner: "A. Rivera",
    },
    companyIds,
    DIR,
  );
  assert.equal(row.company_id, "co-1");
  assert.equal(row.owner_id, "mem-1");
});

test("contactToRow nulls a company name that no longer exists", () => {
  const row = contactToRow(
    { name: "Dana", company: "Gone Co", title: "", email: "", phone: "", owner: "" },
    new Map(),
    DIR,
  );
  assert.equal(row.company_id, null);
});

test("taskToRow carries related_to and nulls an empty due date", () => {
  const row = taskToRow({
    title: "Call back",
    dueDate: "",
    priority: "low",
    type: "call",
    done: false,
    relatedTo: "Dana Reyes",
  });
  assert.equal(row.due_date, null);
  assert.equal(row.related_to, "Dana Reyes");
  assert.equal(row.is_done, false);
  assert.equal(row.completed_at, null);
});

test("taskToRow stamps completed_at only when done", () => {
  const done = taskToRow({ title: "x", dueDate: "", priority: "low", type: "call", done: true, relatedTo: "" });
  const notDone = taskToRow({ title: "x", dueDate: "", priority: "low", type: "call", done: false, relatedTo: "" });
  assert.ok(done.completed_at);
  assert.equal(notDone.completed_at, null);
});

test("activityToRow resolves owner and defaults body to empty", () => {
  const row = activityToRow(
    { type: "note", subject: "Left voicemail", date: "2026-10-26", owner: "A. Rivera", relatedTo: "Apex" },
    DIR,
  );
  assert.equal(row.owner_id, "mem-1");
  assert.equal(row.body, "");
  assert.equal(row.related_to, "Apex");
});

// --- partial updates ------------------------------------------------------

// Mirrors how repository.ts calls patchRow: blank + patch merged inside, and
// only the columns the patch actually set are sent.
const baseLead = {
  company: "Apex",
  contact: "Dana",
  email: "dana@x.example",
  phone: "123",
  source: "Referral" as const,
  status: "new" as LeadStatus,
  score: 10,
  fitScore: 20,
  businessType: "Seller" as const,
  value: 100,
  owner: "A. Rivera",
  lastContact: "",
  nextFollowUp: "",
  evidence: "",
  followUpEvidence: "",
  qualification: "Pending" as const,
  recommendedAction: "",
};

const leadPatch = (
  patch: Partial<typeof baseLead>,
): Record<string, unknown> =>
  patchRow(
    baseLead,
    patch,
    (e) => leadToRow(e, DIR),
    LEAD_PATCH_KEYS,
  );

test("patchRow sends only the columns the patch actually set", () => {
  const payload = leadPatch({ status: "won", value: 250 });

  assert.deepEqual(Object.keys(payload).sort(), ["status", "value"]);
  assert.equal(payload.status, "won");
  assert.equal(payload.value, 250);
  assert.equal(payload.owner_id, undefined, "untouched owner must not be sent");
});

test("patchRow still sends a field the caller explicitly cleared", () => {
  // Clearing nextFollowUp must persist NULL rather than be skipped.
  assert.equal(leadPatch({ nextFollowUp: "" }).next_follow_up, null);

  // An empty patch must send nothing at all.
  assert.deepEqual(leadPatch({}), {});
});

test("patchRow reads values from the merged blank+patch, not stale originals", () => {
  // Regression: an earlier design took a pre-built row, so passing the
  // original entity silently persisted old values. The patch value must win.
  const payload = leadPatch({ company: "Renamed Co" });
  assert.equal(payload.company_name, "Renamed Co");
});

// --- notification prefs (decision �5.3: 4 typed booleans on profiles) -----

test("rowToNotificationPrefs reads the four profiles columns", () => {
  const prefs = rowToNotificationPrefs({
    new_lead_alerts: false,
    daily_digest: true,
    overdue_reminders: false,
    weekly_report: true,
  });
  assert.deepEqual(prefs, {
    newLeadAlerts: false,
    dailyDigest: true,
    overdueReminders: false,
    weeklyReport: true,
  });
});

test("rowToNotificationPrefs falls back to shipped defaults on junk", () => {
  // A missing row (signed out mid-flight) or a non-boolean must never render
  // as false-by-accident for the three switches that default to true.
  assert.deepEqual(rowToNotificationPrefs({}), {
    newLeadAlerts: true,
    dailyDigest: true,
    overdueReminders: true,
    weeklyReport: false,
  });
  assert.deepEqual(
    rowToNotificationPrefs({ weekly_report: "yes" }).weeklyReport,
    false,
  );
});

test("mapping fallbacks match DEFAULT_NOTIFICATION_PREFS exactly", () => {
  // mapping.ts hardcodes the fallback literals (it must stay loadable by
  // node --test); this pins them to the one real source of truth so a
  // defaults change cannot silently desync the two.
  assert.deepEqual(rowToNotificationPrefs({}), DEFAULT_NOTIFICATION_PREFS);
});

test("notificationPrefsToRow round-trips through rowToNotificationPrefs", () => {
  const prefs = {
    newLeadAlerts: false,
    dailyDigest: false,
    overdueReminders: true,
    weeklyReport: true,
  };
  const row = notificationPrefsToRow(prefs);
  assert.deepEqual(Object.keys(row).sort(), [
    "daily_digest",
    "new_lead_alerts",
    "overdue_reminders",
    "weekly_report",
  ]);
  assert.deepEqual(rowToNotificationPrefs(row), prefs);
});
