-- Fairway CRM — B7: invite-only signup + team management (Phase 2B).
--
-- Replaces open self-serve signup (any email could sign up and get its own
-- brand-new workspace) with a closed, invite-only model: an owner invites a
-- partner by email, and only a matching pending invitation lets
-- handle_new_user() admit them — as a MEMBER of the owner's existing
-- workspace with the role the owner chose, never a new workspace of their
-- own. Any signup attempt (through the app's form, or any other client
-- calling Supabase Auth directly) with no matching invitation now fails the
-- whole transaction: the auth.users row is rolled back too, so there is no
-- way to create an account outside this flow.
--
-- No existing row is touched. The only destructive-looking statement is
-- `drop function` on handle_new_user so it can be recreated with a changed
-- body (same function, same trigger, new logic) — Postgres requires that
-- when a function's returns/behaviour changes enough that `create or
-- replace` would conflict, and the existing trigger is dropped/recreated
-- alongside it so there is never a window with no trigger at all within
-- this transaction.

-- ---------------------------------------------------------------------------
-- 1. invitations
-- ---------------------------------------------------------------------------
-- No grants to authenticated/anon at all: every read/write goes through the
-- service role from an owner-gated API route (requireActor + role check).
-- RLS is still enabled with zero policies, so even a leaked anon/authenticated
-- credential cannot read or forge a row directly — "backend authorization
-- and Supabase RLS" both apply, not just one.

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null,
  role         text not null default 'sales_rep'
                 check (role in ('admin', 'sales_rep', 'viewer')),
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'revoked')),
  invited_by   uuid references public.workspace_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz
);

-- One live pending invite per (workspace, email) at a time; re-inviting
-- after a revoke or accept is fine since only 'pending' rows collide.
create unique index invitations_pending_unique_idx
  on public.invitations (workspace_id, lower(email))
  where status = 'pending';

create index invitations_workspace_idx on public.invitations (workspace_id, created_at desc);

alter table public.invitations enable row level security;

grant select, insert, update on public.invitations to service_role;
revoke all on public.invitations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. workspace_members.is_active — deactivate without deleting
-- ---------------------------------------------------------------------------

alter table public.workspace_members
  add column is_active boolean not null default true;

-- Deactivating someone must revoke their access immediately, everywhere
-- RLS gates on workspace membership — so the two helper functions every
-- tenant-table policy calls now require is_active, not just a matching row.

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
      and m.is_active
  );
$$;

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
    and m.is_active
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. activities — idempotent Gmail logging
-- ---------------------------------------------------------------------------

alter table public.activities
  add column provider_message_id text,
  add column direction text check (direction in ('inbound', 'outbound'));

-- A re-sync must never log the same Gmail message twice (per member, since
-- the same thread can legitimately appear in two members' mailboxes).
create unique index activities_provider_message_unique_idx
  on public.activities (workspace_id, owner_id, provider_message_id)
  where provider_message_id is not null;

-- ---------------------------------------------------------------------------
-- 4. handle_new_user() — invite-only
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_inv  record;
begin
  select * into v_inv
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at desc
  limit 1;

  if v_inv is null then
    raise exception 'Signup is invite-only. No pending invitation for %.', new.email
      using errcode = '42501';
  end if;

  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, full_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role, created_by)
  values (v_inv.workspace_id, new.id, v_inv.role, v_inv.invited_by);

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end;
$$;
