-- Fairway CRM — B4: Gmail OAuth connections.
--
-- Additive only. Nothing here deletes or rewrites existing CRM rows.
--
-- Gmail is NOT a shared, workspace-level credential like Google Sheets: each
-- person sends/receives as themselves, so each workspace member connects
-- their own mailbox via a standard OAuth2 authorization-code flow. The
-- resulting access/refresh tokens are personal credentials, not routing
-- config, so they do NOT belong in `integration_connections` (whose SELECT
-- policy intentionally allows any workspace member to read the row — see
-- the b3 migration's comment "Never store OAuth tokens or keys here").
--
-- This table is therefore scoped to the owning member only: no owner/admin
-- override, no cross-member visibility, matching the fact that a workspace
-- admin has no legitimate reason to read a teammate's Gmail refresh token.

create table public.gmail_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  member_id        uuid not null references public.workspace_members (id) on delete cascade,
  email            text,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  scopes           text,
  connected_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint gmail_connections_member_unique unique (member_id)
);

create index gmail_connections_workspace_idx on public.gmail_connections (workspace_id);

alter table public.gmail_connections enable row level security;

create policy gmail_connections_select on public.gmail_connections
  for select using (
    member_id in (select id from public.workspace_members where user_id = auth.uid())
  );

create policy gmail_connections_insert on public.gmail_connections
  for insert with check (
    member_id in (select id from public.workspace_members where user_id = auth.uid())
  );

create policy gmail_connections_update on public.gmail_connections
  for update using (
    member_id in (select id from public.workspace_members where user_id = auth.uid())
  ) with check (
    member_id in (select id from public.workspace_members where user_id = auth.uid())
  );

create policy gmail_connections_delete on public.gmail_connections
  for delete using (
    member_id in (select id from public.workspace_members where user_id = auth.uid())
  );

grant select, insert, update, delete on public.gmail_connections to authenticated;
revoke all on public.gmail_connections from anon;
