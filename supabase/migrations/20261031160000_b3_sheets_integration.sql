-- Fairway CRM — B3: Google Sheets sync + integration connections.
--
-- Additive only. Nothing here deletes or rewrites existing CRM rows.
--
-- Design notes
-- ------------
-- * `sync_key` is a STABLE natural-key fingerprint (lowercased company name,
--   contact email, lead email+company, …) written by the sync engine. It is
--   deliberately NOT a spreadsheet row number: sorting/inserting rows in the
--   sheet must never change a record's identity.
-- * `integration_connections.config` holds only non-secret routing data
--   (spreadsheet id, tab name, column overrides). Google credentials stay in
--   server environment variables and never reach the database or the browser.
-- * `sheet_sync_runs` is the immutable audit log for every dry-run and apply.
--   It has SELECT policies only: rows are written by the server with the
--   service-role key after the caller's workspace membership is verified.
-- * RLS stays enabled on every new table. Workspace isolation is unchanged.

-- ---------------------------------------------------------------------------
-- 1. Stable identity columns for spreadsheet-managed records
-- ---------------------------------------------------------------------------

alter table public.companies add column sync_key text;
alter table public.contacts  add column sync_key text;
alter table public.leads     add column sync_key text;

create unique index companies_workspace_sync_key_unique_idx
  on public.companies (workspace_id, sync_key)
  where sync_key is not null;

create unique index contacts_workspace_sync_key_unique_idx
  on public.contacts (workspace_id, sync_key)
  where sync_key is not null;

create unique index leads_workspace_sync_key_unique_idx
  on public.leads (workspace_id, sync_key)
  where sync_key is not null;

-- Gmail message id (or any future provider message id) so re-syncing an inbox
-- cannot create duplicate email activities.
alter table public.activities add column external_id text;

create unique index activities_workspace_external_id_unique_idx
  on public.activities (workspace_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Integration connections (per workspace, per provider)
-- ---------------------------------------------------------------------------

create table public.integration_connections (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  provider              text not null
                          check (provider in ('google_sheets', 'gmail', 'instagram', 'linkedin')),
  is_enabled            boolean not null default true,
  -- Non-secret routing/config only. Never store OAuth tokens or keys here.
  config                jsonb not null default '{}'::jsonb,
  auto_sync             boolean not null default false,
  sync_interval_minutes integer not null default 360
                          check (sync_interval_minutes between 15 and 10080),
  last_synced_at        timestamptz,
  last_status           text
                          check (last_status is null or last_status in ('never', 'ok', 'partial', 'failed')),
  last_error            text,
  created_by            uuid references public.workspace_members (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint integration_connections_workspace_provider_unique
    unique (workspace_id, provider)
);

create index integration_connections_workspace_idx
  on public.integration_connections (workspace_id);

alter table public.integration_connections enable row level security;

-- Every member may read the connection (so Settings can show status).
create policy integration_connections_select on public.integration_connections
  for select using (public.is_workspace_member(workspace_id));

-- Only owner/admin may change connection configuration.
create policy integration_connections_insert on public.integration_connections
  for insert with check (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
  );

create policy integration_connections_update on public.integration_connections
  for update using (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
  ) with check (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
  );

create policy integration_connections_delete on public.integration_connections
  for delete using (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 3. Sync run audit log (dry-run reports + applied runs)
-- ---------------------------------------------------------------------------

create table public.sheet_sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  connection_id      uuid references public.integration_connections (id) on delete set null,
  mode               text not null check (mode in ('dry_run', 'apply')),
  triggered_by       text not null default 'manual'
                       check (triggered_by in ('manual', 'scheduled', 'api')),
  status             text not null default 'running'
                       check (status in ('running', 'completed', 'partial', 'failed')),
  sheet_title        text,
  total_rows         integer not null default 0 check (total_rows >= 0),
  companies_created  integer not null default 0 check (companies_created >= 0),
  companies_updated  integer not null default 0 check (companies_updated >= 0),
  contacts_created   integer not null default 0 check (contacts_created >= 0),
  contacts_updated   integer not null default 0 check (contacts_updated >= 0),
  leads_created      integer not null default 0 check (leads_created >= 0),
  leads_updated      integer not null default 0 check (leads_updated >= 0),
  skipped_rows       integer not null default 0 check (skipped_rows >= 0),
  invalid_rows       integer not null default 0 check (invalid_rows >= 0),
  error_summary      text,
  -- Full dry-run report: headers, mappings, per-row errors, update/skip lists.
  report             jsonb not null default '{}'::jsonb,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  created_by         uuid references public.workspace_members (id) on delete set null
);

create index sheet_sync_runs_workspace_created_idx
  on public.sheet_sync_runs (workspace_id, started_at desc);

alter table public.sheet_sync_runs enable row level security;

create policy sheet_sync_runs_select on public.sheet_sync_runs
  for select using (public.is_workspace_member(workspace_id));

-- No insert/update/delete policies: only the server-side service role writes
-- audit rows, after verifying the caller's workspace membership. Members can
-- read history but cannot forge or delete it.

-- ---------------------------------------------------------------------------
-- 4. Grant surface (RLS still filters rows; these only enable PostgREST verbs)
-- ---------------------------------------------------------------------------

grant select on public.integration_connections to authenticated;
grant insert, update, delete on public.integration_connections to authenticated;
grant select on public.sheet_sync_runs to authenticated;

revoke all on public.integration_connections from anon;
revoke all on public.sheet_sync_runs from anon;
