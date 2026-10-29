-- Fairway CRM — Backend Phase B2, Step 1
-- Resolves §13.12 decision 3 (notification preference storage).
--
-- Decision: 4 typed boolean columns on public.profiles, NOT an opaque jsonb
-- blob. The Settings → Notifications tab is a closed set of four switches
-- with fixed semantics; typed columns keep NOT NULL discipline and stay
-- consistent with the rest of the schema. Each default matches the value the
-- UI ships with today (src/app/settings/page.tsx `notifications` state).
--
-- Additive and backward compatible: existing rows get the shipped defaults.
-- profiles RLS already restricts writes to the row owner (profiles_update),
-- so these columns are self-service only; no policy change is required.

alter table public.profiles
  add column new_lead_alerts   boolean not null default true,
  add column daily_digest      boolean not null default true,
  add column overdue_reminders boolean not null default true,
  add column weekly_report     boolean not null default false;

-- ---------------------------------------------------------------------------
-- related_to parity fix
-- ---------------------------------------------------------------------------
-- The B1 plan (docs/backend-b1-plan.md §5.9/§5.10) specifies
-- `related_to text not null default ''` on tasks and activities as REQUIRED
-- for frontend parity: the UI's "Related to" input is free text with a
-- datalist suggestion list (src/app/tasks|activities/page.tsx), and it writes
-- a display string, not a foreign key. That column was never created in
-- b1_schema.sql, so the live adapter would have had nowhere to persist it.
--
-- Added here, additive, with the plan's declared default. The lead/company/
-- contact FK columns stay as optional enrichment; this text column is the
-- authoritative display value, mirroring how leads.company_name coexists
-- with leads.company_id.

alter table public.tasks
  add column related_to text not null default '';

alter table public.activities
  add column related_to text not null default '';
