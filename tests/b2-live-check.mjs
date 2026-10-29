// B2 live verification — runs against a LOCAL Supabase stack only.
//
// Proves, through the real client SDK (PostgREST + GoTrue, not the SQL
// harness): signup bootstrap, RLS tenant isolation, notification-prefs
// columns, and that unauthenticated callers see nothing.
//
// Requires a local stack (`supabase start`) and:
//   B2_URL, B2_ANON_KEY  — from `supabase status`
// Refuses to run against anything that is not loopback, so this can never
// touch a remote project.
//
//   node tests/b2-live-check.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.B2_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.B2_ANON_KEY;

if (!anonKey) {
  console.error("B2_ANON_KEY is required (from `supabase status`).");
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(url)) {
  console.error(
    `Refusing to run against non-loopback URL "${url}". This check is local-only.`,
  );
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const stamp = Date.now();
const mk = (who) =>
  createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": `b2-live-check/${who}` } },
  });

async function signup(client, label) {
  const { data, error } = await client.auth.signUp({
    email: `b2-${label}-${stamp}@fairway.test`,
    password: "B2-probe-passw0rd!",
    options: { data: { full_name: `B2 ${label}` } },
  });
  if (error) throw new Error(`signup ${label}: ${error.message}`);
  return data.user;
}

console.log(`B2 live check against ${url}`);

// --- 1. bootstrap: signup must yield workspace + member + stages + sources ---
const alice = mk("alice");
const aliceUser = await signup(alice, "alice");
check("signup returns a user", Boolean(aliceUser?.id));

const { data: ownWs, error: ownWsErr } = await alice.from("workspaces").select("id, name, slug");
check(
  "new user can read their own workspace",
  !ownWsErr && Array.isArray(ownWs) && ownWs.length === 1,
  ownWsErr?.message,
);

const wsId = ownWs?.[0]?.id;
const { data: members } = await alice.from("workspace_members").select("id, role");
check(
  "signup bootstrap grants exactly one owner membership",
  members?.length === 1 && members[0].role === "owner",
  JSON.stringify(members),
);

const { data: stages } = await alice.from("pipeline_stages").select("key, position");
check(
  "bootstrap creates the 6 pipeline stages",
  stages?.length === 6,
  JSON.stringify(stages),
);

const { data: sources } = await alice.from("lead_sources").select("name, is_system");
check(
  "bootstrap creates the 6 system lead sources",
  sources?.length === 6 && sources.every((s) => s.is_system === true),
  JSON.stringify(sources),
);

// --- 2. notification prefs: readable and self-writable defaults ---
const { data: prof } = await alice
  .from("profiles")
  .select("new_lead_alerts, daily_digest, overdue_reminders, weekly_report")
  .eq("id", aliceUser.id)
  .single();
check(
  "notification prefs default to true,true,true,false",
  prof?.new_lead_alerts === true &&
    prof?.daily_digest === true &&
    prof?.overdue_reminders === true &&
    prof?.weekly_report === false,
  JSON.stringify(prof),
);

const { error: prefsErr } = await alice
  .from("profiles")
  .update({ weekly_report: true })
  .eq("id", aliceUser.id);
const { data: prof2 } = await alice
  .from("profiles")
  .select("weekly_report")
  .eq("id", aliceUser.id)
  .single();
check(
  "owner can update their own notification prefs",
  !prefsErr && prof2?.weekly_report === true,
  prefsErr?.message,
);

// --- 3. write + read a lead through PostgREST ---
const { data: src } = await alice.from("lead_sources").select("id").eq("name", "Referral").single();
const { data: stage } = await alice
  .from("pipeline_stages")
  .select("key")
  .eq("key", "new")
  .single();
const leadRow = {
  workspace_id: wsId,
  company_name: "Apex Indoor Golf",
  contact_name: "Dana Reyes",
  email: "dana@apexindoor.example",
  source_id: src?.id ?? null,
  status: stage?.key ?? "new",
  business_type: "Both",
  value: 42000,
  score: 88,
  fit_score: 91,
  qualification: "Qualified",
  evidence: "Two bays, asked about financing.",
  recommended_action: "Send financing one-pager.",
};
const { data: inserted, error: insErr } = await alice
  .from("leads")
  .insert(leadRow)
  .select("id, company_name, value, status")
  .single();
check(
  "authenticated user inserts a lead",
  !insErr && inserted?.company_name === "Apex Indoor Golf",
  insErr?.message,
);

const { data: reread } = await alice.from("leads").select("id, value").eq("id", inserted?.id).single();
check(
  "inserted lead reads back with numeric value",
  Number(reread?.value) === 42000,
  JSON.stringify(reread),
);

// --- 4. score history is written by trigger, immutable to clients ---
const { error: scoreErr } = await alice.from("leads").update({ score: 95 }).eq("id", inserted.id);
const { data: events } = await alice
  .from("lead_score_events")
  .select("score, computed_by")
  .eq("lead_id", inserted.id);
check(
  "score update writes an append-only score event",
  !scoreErr && events?.length === 1 && events[0].score === 95,
  JSON.stringify(events),
);

const { error: forgeErr } = await alice
  .from("lead_score_events")
  .insert({ workspace_id: wsId, lead_id: inserted.id, score: 1, computed_by: "manual" });
check("client cannot forge a score event", Boolean(forgeErr), JSON.stringify(forgeErr));

// --- 5. tasks/activities persist free-text related_to (B2 parity fix) ---
const { data: task, error: taskErr } = await alice
  .from("tasks")
  .insert({
    workspace_id: wsId,
    title: "Send financing one-pager",
    due_date: "2026-11-02",
    priority: "high",
    type: "follow-up",
    is_done: false,
    related_to: "Apex Indoor Golf",
  })
  .select("id, related_to, due_date, priority")
  .single();
check(
  "task persists free-text related_to",
  !taskErr && task?.related_to === "Apex Indoor Golf",
  taskErr?.message ?? JSON.stringify(task),
);
check(
  "task due_date round-trips as a plain date string",
  task?.due_date === "2026-11-02",
  JSON.stringify(task),
);

const { data: act, error: actErr } = await alice
  .from("activities")
  .insert({
    workspace_id: wsId,
    type: "call",
    subject: "Intro call",
    body: "Discussed bays and financing.",
    related_to: "Dana Reyes",
    lead_id: inserted.id,
  })
  .select("id, related_to, type, lead_id")
  .single();
check(
  "activity persists free-text related_to and lead link",
  !actErr && act?.related_to === "Dana Reyes" && act?.lead_id === inserted.id,
  actErr?.message ?? JSON.stringify(act),
);

// --- 6. tenant isolation: a second user sees none of Alice's data ---
const bob = mk("bob");
await signup(bob, "bob");
const { data: bobLeads } = await bob.from("leads").select("id");
check("second user sees zero leads (RLS isolation)", bobLeads?.length === 0, JSON.stringify(bobLeads));
const { data: bobWs } = await bob.from("workspaces").select("id");
check(
  "second user sees only their own workspace",
  bobWs?.length === 1 && bobWs[0].id !== wsId,
  JSON.stringify(bobWs),
);
const { data: bobSeesAlice } = await bob
  .from("leads")
  .select("id")
  .eq("id", inserted.id);
check("second user cannot read Alice's lead by id", bobSeesAlice?.length === 0, JSON.stringify(bobSeesAlice));

// --- 7. unauthenticated (anon) sees no data by any path ---
// Note: the schema revokes ALL table grants from `anon` (b1_schema §8), so
// PostgREST answers with `permission denied for table <t>` and data:null —
// stricter than an empty result set. Either outcome is acceptable here; what
// must never happen is a non-empty result.
const anon = mk("anon");
const anonLeads = await anon.from("leads").select("id");
const anonWs = await anon.from("workspaces").select("id");
const anonProf = await anon.from("profiles").select("id");
const anonScore = await anon.from("lead_score_events").select("id");
const leaksData = (r) => Array.isArray(r.data) && r.data.length > 0;
check(
  "anon gets no leads (denied or empty)",
  !leaksData(anonLeads),
  JSON.stringify(anonLeads),
);
check(
  "anon gets no workspaces (denied or empty)",
  !leaksData(anonWs),
  JSON.stringify(anonWs),
);
check(
  "anon gets no profiles (denied or empty)",
  !leaksData(anonProf),
  JSON.stringify(anonProf),
);
check(
  "anon gets no score history (denied or empty)",
  !leaksData(anonScore),
  JSON.stringify(anonScore),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
