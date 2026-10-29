-- Fairway CRM — Backend Phase B2, Step 1
-- Implements the approved B1 design (docs/backend-b1-plan.md).
--
-- Scope: schema, constraints, indexes, triggers and RLS only.
-- No frontend wiring, no auth UI, no CRUD APIs, no demo seed data.
--
-- Security decisions taken while implementing (plan gaps resolved):
--   1. handle_new_user() derives the user id ONLY from NEW.id and always
--      creates a brand-new workspace with a server-generated id. It never
--      reads a workspace id or a role from client-supplied signup metadata,
--      so a crafted signup cannot grant access to an existing tenant or
--      self-assign 'owner' anywhere.
--   2. Every SECURITY DEFINER function uses `set search_path = ''` with
--      fully-qualified objects (stricter than the plan's `search_path =
--      public`), which is immune to object-shadowing via search_path.
--   3. RLS write policies are role-gated by explicit role lists. The plan's
--      "viewer gets select-only policies layered on top" cannot work as
--      written: permissive policies are OR-ed, so a broad member-write
--      policy plus a viewer-select policy would still let viewers write.
--      Writers here are ('owner','admin','sales_rep') only.
--
-- The pre-existing empty migration
--   supabase/migrations/20261022102536_initial_schema.sql
-- is intentionally left untouched.

-- ============================================================================
-- 1. Tables (dependency order)
-- ============================================================================

create table public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique,
  country            text not null default 'USA'
                       check (country in ('USA', 'Canada', 'Mexico')),
  currency           text not null default 'USD'
                       check (currency in ('USD', 'CAD', 'MXN')),
  fiscal_start_month smallint not null default 1
                       check (fiscal_start_month between 1 and 12),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  avatar_url text,
  timezone   text not null default 'America/Chicago',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- Email intentionally lives only in auth.users (plan §5.2).
);

create table public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'sales_rep'
                 check (role in ('owner', 'admin', 'sales_rep', 'viewer')),
  created_by   uuid references public.workspace_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint workspace_members_unique unique (workspace_id, user_id)
);

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  business_type text not null default 'Seller'
                  check (business_type in ('Seller', 'Installer', 'Both')),
  city          text,
  region        text,
  country       text not null default 'USA'
                  check (country in ('USA', 'Canada', 'Mexico')),
  website       text,
  email         text,
  phone         text,
  fit_score     smallint check (fit_score between 0 and 100),
  notes         text not null default '',
  owner_id      uuid references public.workspace_members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete cascade,
  name         text not null,
  title        text not null default '',
  email        text,
  phone        text,
  owner_id     uuid references public.workspace_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.lead_sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key          text not null
                 check (key in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost')),
  label        text not null,
  position     smallint not null,
  kind         text not null check (kind in ('open', 'won', 'lost')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pipeline_stages_unique_key unique (workspace_id, key),
  constraint pipeline_stages_unique_position unique (workspace_id, position)
);

create table public.lead_imports (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  source_name   text,
  file_name     text,
  status        text not null default 'processing'
                  check (status in ('processing', 'completed', 'failed')),
  total_rows    integer not null default 0 check (total_rows >= 0),
  created_rows  integer not null default 0 check (created_rows >= 0),
  failed_rows   integer not null default 0 check (failed_rows >= 0),
  error_summary text,
  imported_by   uuid references public.workspace_members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  -- Nullable on purpose: the Add-Lead form creates a lead before any company
  -- record exists (plan §5.6). company_name below keeps it renderable.
  company_id           uuid references public.companies (id) on delete set null,
  company_name         text not null,
  contact_name         text not null default '',
  contact_id           uuid references public.contacts (id) on delete set null,
  email                text,
  phone                text,
  source_id            uuid references public.lead_sources (id) on delete set null,
  status               text not null default 'new'
                         check (status in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost')),
  business_type        text not null default 'Seller'
                         check (business_type in ('Seller', 'Installer', 'Both')),
  value                numeric(12, 2) not null default 0 check (value >= 0),
  currency             text not null default 'USD'
                         check (currency in ('USD', 'CAD', 'MXN')),
  score                smallint check (score between 0 and 100),
  fit_score            smallint check (fit_score between 0 and 100),
  qualification        text not null default 'Pending'
                         check (qualification in ('Qualified', 'Needs review', 'Pending', 'Disqualified')),
  evidence             text not null default '',
  follow_up_evidence   text not null default '',
  recommended_action   text not null default '',
  owner_id             uuid references public.workspace_members (id) on delete set null,
  last_contact         date,
  next_follow_up       date,
  closed_at            timestamptz,
  import_id            uuid references public.lead_imports (id) on delete set null,
  created_by           uuid references public.workspace_members (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title        text not null,
  due_date     date,
  priority     text not null default 'medium'
                 check (priority in ('low', 'medium', 'high')),
  type         text not null default 'follow-up'
                 check (type in ('call', 'email', 'meeting', 'follow-up', 'admin')),
  is_done      boolean not null default false,
  completed_at timestamptz,
  lead_id      uuid references public.leads (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete cascade,
  contact_id   uuid references public.contacts (id) on delete cascade,
  assignee_id  uuid references public.workspace_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type         text not null
                 check (type in ('call', 'email', 'meeting', 'note', 'follow-up')),
  subject      text not null,
  body         text not null default '',
  occurred_at  timestamptz not null default now(),
  lead_id      uuid references public.leads (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete cascade,
  contact_id   uuid references public.contacts (id) on delete cascade,
  owner_id     uuid references public.workspace_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Append-only audit trail for lead scoring (plan §5.11, §7.3).
-- No updated_at by design: history rows are never edited.
create table public.lead_score_events (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  lead_id             uuid not null references public.leads (id) on delete cascade,
  score               smallint check (score between 0 and 100),
  fit_score           smallint check (fit_score between 0 and 100),
  qualification       text
                        check (qualification is null or qualification in ('Qualified', 'Needs review', 'Pending', 'Disqualified')),
  evidence            text,
  follow_up_evidence  text,
  recommended_action  text,
  computed_by         text not null default 'manual'
                        check (computed_by in ('manual', 'system', 'import')),
  created_by          uuid references public.workspace_members (id) on delete set null,
  created_at          timestamptz not null default now()
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Duplicate-name guard for the company directory (plan §5.4).
create unique index companies_workspace_name_unique_idx
  on public.companies (workspace_id, lower(name));
create index companies_workspace_country_idx on public.companies (workspace_id, country);
create index companies_workspace_business_type_idx on public.companies (workspace_id, business_type);
create index companies_workspace_fit_score_idx on public.companies (workspace_id, fit_score desc);

create unique index contacts_workspace_email_unique_idx
  on public.contacts (workspace_id, lower(email))
  where email <> '';
create index contacts_workspace_company_idx on public.contacts (workspace_id, company_id);
create index contacts_workspace_name_idx on public.contacts (workspace_id, lower(name));

create unique index lead_sources_workspace_name_unique_idx
  on public.lead_sources (workspace_id, lower(name));

create index leads_workspace_status_idx on public.leads (workspace_id, status);
create index leads_workspace_owner_idx on public.leads (workspace_id, owner_id);
-- Overdue follow-up queries (plan §5.6).
create index leads_workspace_next_follow_up_idx
  on public.leads (workspace_id, next_follow_up)
  where status not in ('won', 'lost');
create index leads_workspace_created_at_idx on public.leads (workspace_id, created_at desc);
create index leads_workspace_company_name_idx on public.leads (workspace_id, lower(company_name));

create index tasks_workspace_open_due_idx on public.tasks (workspace_id, is_done, due_date);
create index tasks_workspace_assignee_idx on public.tasks (workspace_id, assignee_id);

create index activities_workspace_occurred_at_idx on public.activities (workspace_id, occurred_at desc);
create index activities_workspace_lead_occurred_at_idx on public.activities (workspace_id, lead_id, occurred_at desc);

create index lead_score_events_lead_created_at_idx
  on public.lead_score_events (lead_id, created_at desc);
create index lead_score_events_workspace_idx on public.lead_score_events (workspace_id);

create index lead_imports_workspace_idx on public.lead_imports (workspace_id, created_at desc);

-- ============================================================================
-- 3. Shared updated_at trigger
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'workspaces', 'profiles', 'workspace_members', 'companies', 'contacts',
    'lead_sources', 'pipeline_stages', 'lead_imports', 'leads', 'tasks',
    'activities'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- 4. RLS helper functions
-- ============================================================================
-- All helpers are SECURITY DEFINER with an empty search_path and fully
-- qualified objects. SECURITY DEFINER also avoids RLS recursion, since each
-- helper queries workspace_members directly rather than through the caller's
-- policy context.

create or replace function public.is_workspace_member(w uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = w
      and m.user_id = auth.uid()
  );
$$;

-- Null for non-members, so `role in (...)` in a policy evaluates to NULL
-- (treated as false) rather than accidentally matching.
create or replace function public.current_workspace_role(w uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = w
    and m.user_id = auth.uid()
  limit 1;
$$;

-- True when the caller shares at least one workspace with the given user.
-- Used by the profiles read policy (plan §5.2).
create or replace function public.shares_workspace_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    where mine.user_id = auth.uid()
      and exists (
        select 1
        from public.workspace_members theirs
        where theirs.workspace_id = mine.workspace_id
          and theirs.user_id = other_user
      )
  );
$$;

-- ============================================================================
-- 5. Signup bootstrap trigger (auth.users -> profile + personal workspace)
-- ============================================================================
-- SECURITY CRITICAL: the only inputs are NEW.id (server-owned auth row id)
-- and NEW.email / NEW.raw_user_meta_data for display purposes. The workspace
-- id is always generated here and the role is always hardcoded to 'owner',
-- so client-supplied signup metadata cannot attach the new user to an
-- existing workspace or grant any other role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text;
  v_ws_name  text;
  v_ws_slug  text;
  v_ws_id    uuid;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, full_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  v_ws_name := v_name || '''s workspace';
  -- Slug is generated, never taken from client input, and suffixed with a
  -- random fragment so uniqueness can never abort a signup.
  v_ws_slug := left(rtrim(regexp_replace(lower(v_ws_name), '[^a-z0-9]+', '-', 'g'), '-'), 40)
               || '-' || left(md5(new.id::text || random()::text), 8);

  insert into public.workspaces (name, slug)
  values (v_ws_name, v_ws_slug)
  returning id into v_ws_id;

  -- Role is hardcoded: every signup becomes owner of their OWN new workspace
  -- only. created_by is left null (no prior inviter at signup).
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, new.id, 'owner');

  -- Default board columns + lead sources for the new workspace.
  insert into public.pipeline_stages (workspace_id, key, label, position, kind)
  values
    (v_ws_id, 'new',       'New',       1, 'open'),
    (v_ws_id, 'contacted', 'Contacted', 2, 'open'),
    (v_ws_id, 'qualified', 'Qualified', 3, 'open'),
    (v_ws_id, 'proposal',  'Proposal',  4, 'open'),
    (v_ws_id, 'won',       'Won',       5, 'won'),
    (v_ws_id, 'lost',      'Lost',      6, 'lost');

  insert into public.lead_sources (workspace_id, name, is_system)
  values
    (v_ws_id, 'Website',    true),
    (v_ws_id, 'Referral',   true),
    (v_ws_id, 'Trade show', true),
    (v_ws_id, 'Cold call',  true),
    (v_ws_id, 'Partner',    true),
    (v_ws_id, 'Social',     true);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 6. Lead score history trigger
-- ============================================================================
-- SECURITY DEFINER so the snapshot insert succeeds even though lead_score_events
-- has no client insert policy (append-only via trigger, plan §8).

create or replace function public.log_lead_score_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Snapshot whenever any explainable part of the score moves (plan §5.11
  -- lists all six fields; using the full set keeps history reconstructable).
  if new.score is distinct from old.score
     or new.fit_score is distinct from old.fit_score
     or new.qualification is distinct from old.qualification
     or new.evidence is distinct from old.evidence
     or new.follow_up_evidence is distinct from old.follow_up_evidence
     or new.recommended_action is distinct from old.recommended_action
  then
    insert into public.lead_score_events (
      workspace_id, lead_id, score, fit_score, qualification,
      evidence, follow_up_evidence, recommended_action,
      computed_by, created_by
    ) values (
      new.workspace_id, new.id, new.score, new.fit_score, new.qualification,
      new.evidence, new.follow_up_evidence, new.recommended_action,
      'system', new.owner_id
    );
  end if;

  return new;
end;
$$;

create trigger log_lead_score_event
  before update on public.leads
  for each row execute function public.log_lead_score_event();

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================

alter table public.workspaces         enable row level security;
alter table public.profiles           enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.companies          enable row level security;
alter table public.contacts           enable row level security;
alter table public.lead_sources       enable row level security;
alter table public.pipeline_stages    enable row level security;
alter table public.lead_imports       enable row level security;
alter table public.leads              enable row level security;
alter table public.tasks              enable row level security;
alter table public.activities         enable row level security;
alter table public.lead_score_events  enable row level security;

-- workspaces: members read, owner/admin update. No insert policy — new
-- workspaces are created only by handle_new_user(). No delete policy yet
-- (plan defers deletion to owner-only, B2+), so deletes are denied.

create policy workspaces_select on public.workspaces
  for select using (public.is_workspace_member(id));

create policy workspaces_update on public.workspaces
  for update using (public.current_workspace_role(id) in ('owner', 'admin'))
  with check (public.current_workspace_role(id) in ('owner', 'admin'));

-- profiles: self or co-member read; self-only write. No insert policy
-- (created by the signup trigger), no delete policy (auth.users cascade).

create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.shares_workspace_with(id)
  );

create policy profiles_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- workspace_members: co-members read. Only owner/admin manage membership.
-- The with-check prevents an admin from minting a new 'owner' (privilege
-- escalation): only an owner may grant the owner role.

create policy workspace_members_select on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

create policy workspace_members_insert on public.workspace_members
  for insert with check (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
    and (
      role <> 'owner'
      or public.current_workspace_role(workspace_id) = 'owner'
    )
  );

create policy workspace_members_update on public.workspace_members
  for update using (public.current_workspace_role(workspace_id) in ('owner', 'admin'))
  with check (
    public.current_workspace_role(workspace_id) in ('owner', 'admin')
    and (
      role <> 'owner'
      or public.current_workspace_role(workspace_id) = 'owner'
    )
  );

create policy workspace_members_delete on public.workspace_members
  for delete using (public.current_workspace_role(workspace_id) in ('owner', 'admin'));

-- Tenant CRUD tables: every member reads; owner/admin/sales_rep write.
-- 'viewer' is deliberately excluded from every write policy.

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'contacts', 'lead_sources', 'pipeline_stages',
    'lead_imports', 'leads', 'tasks', 'activities'
  ]
  loop
    execute format(
      'create policy %I_select on public.%I
         for select using (public.is_workspace_member(workspace_id))',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I
         for insert with check (public.current_workspace_role(workspace_id) in (''owner'', ''admin'', ''sales_rep''))',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I
         for update using (public.current_workspace_role(workspace_id) in (''owner'', ''admin'', ''sales_rep''))
         with check (public.current_workspace_role(workspace_id) in (''owner'', ''admin'', ''sales_rep''))',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I
         for delete using (public.current_workspace_role(workspace_id) in (''owner'', ''admin'', ''sales_rep''))',
      t, t
    );
  end loop;
end;
$$;

-- lead_score_events: members read only. No insert/update/delete policies at
-- all — history is written by the SECURITY DEFINER trigger and is immutable
-- from the client.

create policy lead_score_events_select on public.lead_score_events
  for select using (public.is_workspace_member(workspace_id));

-- ============================================================================
-- 8. Privileges
-- ============================================================================
-- RLS scopes rows; these grants narrow which operations PostgREST will even
-- offer. trigger-only functions stay non-executable by API roles.

revoke execute on function public.set_updated_at()            from public, anon, authenticated;
revoke execute on function public.log_lead_score_event()      from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;

revoke execute on function public.is_workspace_member(uuid)   from public, anon;
revoke execute on function public.current_workspace_role(uuid) from public, anon;
revoke execute on function public.shares_workspace_with(uuid) from public, anon;

grant execute on function public.is_workspace_member(uuid)    to authenticated;
grant execute on function public.current_workspace_role(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid)  to authenticated;

-- The auth service role runs the signup trigger and needs EXECUTE on it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end;
$$;

-- lead_score_events is append-only from the API's point of sight.
revoke insert, update, delete on public.lead_score_events from anon, authenticated;

-- No unauthenticated table access anywhere.
revoke all on all tables in schema public from anon;
