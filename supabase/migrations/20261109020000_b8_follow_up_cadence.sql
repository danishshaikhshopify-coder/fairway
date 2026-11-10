-- Fairway CRM — B8: 20-Day Follow-up & Task Automation.
--
-- Adds a configurable, multi-step follow-up cadence (interval + channel per
-- step) and the bookkeeping needed to generate exactly one task per step per
-- lead, in order, without ever sending anything itself — every generated
-- row is a task that reminds a human to act, never an outreach message.
--
-- Additive only: no existing column, row or constraint is changed or
-- dropped. Not applied to the hosted DB — staged here for review per the
-- standing "no production migration without approval" instruction.

-- ---------------------------------------------------------------------------
-- 1. cadence_steps — the admin-configured cadence (Settings -> Follow-ups)
-- ---------------------------------------------------------------------------
-- One row per step, in order. "Admin can configure" maps directly to the
-- existing 'admin'/'owner' roles (see canConfigure() in src/lib/api/auth.ts),
-- not the broader owner/admin/sales_rep write tier every other tenant table
-- uses — sales reps work the cadence, they don't redesign it.

create table public.cadence_steps (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  step_number   smallint not null check (step_number >= 1),
  interval_days smallint not null check (interval_days >= 1),
  channel       text not null check (channel in ('email', 'linkedin', 'whatsapp', 'call')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cadence_steps_unique_step unique (workspace_id, step_number)
);

create trigger set_updated_at before update on public.cadence_steps
  for each row execute function public.set_updated_at();

alter table public.cadence_steps enable row level security;

create policy cadence_steps_select on public.cadence_steps
  for select using (public.is_workspace_member(workspace_id));

create policy cadence_steps_insert on public.cadence_steps
  for insert with check (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy cadence_steps_update on public.cadence_steps
  for update using (public.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

create policy cadence_steps_delete on public.cadence_steps
  for delete using (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

grant select, insert, update, delete on public.cadence_steps to authenticated;
grant all on public.cadence_steps to service_role;
revoke all on public.cadence_steps from anon;

-- Seed a sensible default (3 + 4 + 6 + 7 = 20 days) for every existing
-- workspace, so the system works out of the box; the admin can edit or
-- replace it from Settings at any time. Idempotent: skipped for a workspace
-- that already has steps.
insert into public.cadence_steps (workspace_id, step_number, interval_days, channel)
select w.id, s.step_number, s.interval_days, s.channel
from public.workspaces w
cross join (
  values (1, 3, 'call'), (2, 4, 'email'), (3, 6, 'linkedin'), (4, 7, 'whatsapp')
) as s(step_number, interval_days, channel)
where not exists (
  select 1 from public.cadence_steps c where c.workspace_id = w.id
);

-- ---------------------------------------------------------------------------
-- 2. leads — per-lead cadence state
-- ---------------------------------------------------------------------------
-- cadence_step: the highest step already generated for this lead (0 = none
-- yet). cadence_anchor_date: the due date the NEXT interval counts from —
-- the previous step's due date, or null until step 1 exists (step 1 instead
-- anchors off last_contact/created_at, computed at generation time, see
-- src/lib/cadence/generate.ts). cadence_paused: "pause a lead's cadence",
-- checked before every generation, cron and completion-triggered alike.
--
-- No RLS change needed: these are plain columns on an existing table whose
-- row-level policies already cover every column.

alter table public.leads
  add column cadence_paused     boolean not null default false,
  add column cadence_step       smallint not null default 0,
  add column cadence_anchor_date date;

-- ---------------------------------------------------------------------------
-- 3. tasks — cadence linkage + a real "cancelled" state
-- ---------------------------------------------------------------------------
-- channel/cadence_step are set only on cadence-generated tasks; both null on
-- every manually-added task. cancelled_at is new and distinct from
-- is_done/completed_at: "cancel" must not delete the row, because deleting
-- it would let the cron or the next completion regenerate the exact same
-- step — see the unique index below, which has no cancelled_at exception on
-- purpose (a cancelled step stays cancelled, it is never recreated).

alter table public.tasks
  add column channel      text check (channel in ('email', 'linkedin', 'whatsapp', 'call')),
  add column cadence_step smallint,
  add column cancelled_at timestamptz;

-- One task per (lead, cadence step), ever — the hard backstop behind the
-- application-level dedupe check in generateNextFollowUp().
create unique index tasks_cadence_dedupe_idx
  on public.tasks (lead_id, cadence_step)
  where lead_id is not null and cadence_step is not null;
