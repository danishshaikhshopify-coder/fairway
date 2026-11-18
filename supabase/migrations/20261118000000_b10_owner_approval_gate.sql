-- Fairway CRM — B10: owner-approval gate for new/reactivated members.
--
-- Until now, handle_new_user() (B7) admitted an invitee into
-- workspace_members with is_active = true and flipped the invitation to
-- 'accepted' the instant the owner clicked invite — before the invitee had
-- even opened the email or set a password. Ownership of "who becomes an
-- active member" now moves entirely to an explicit owner Approve/Reject
-- step: this trigger still enforces invite-only signup (same exception
-- guard as B7), but only ever admits someone into a PENDING, inactive row.
-- No existing row is touched; only new signups are affected.
--
-- Same drop/recreate shape B7 already used for handle_new_user(), for the
-- same reason: changing a function this much needs the trigger dropped and
-- recreated alongside it so there is never a window with no trigger.

-- ---------------------------------------------------------------------------
-- 1. invitations — new statuses + rejected_at
-- ---------------------------------------------------------------------------
-- Adds 'awaiting_approval' (invitee has set a password, waiting on the
-- owner) and 'rejected' (owner declined) to the status lifecycle. The
-- constraint name below is Postgres's default auto-generated name for the
-- original unnamed inline check() in B7 — confirm it still matches the live
-- schema (e.g. via information_schema.table_constraints) before this
-- migration is ever applied to production; do not assume it blindly.

alter table public.invitations
  drop constraint if exists invitations_status_check;

alter table public.invitations
  add constraint invitations_status_check
    check (status in ('pending', 'awaiting_approval', 'accepted', 'revoked', 'rejected'));

alter table public.invitations
  add column rejected_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. team_audit_log — append-only record of team-management/security events
-- ---------------------------------------------------------------------------
-- Same pattern as invitations (B7): RLS enabled, zero authenticated/anon
-- policies — every read/write goes through the service role from an
-- owner-gated API route. A leaked anon/authenticated credential cannot
-- read or forge an entry directly.

create table public.team_audit_log (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  actor_member_id  uuid references public.workspace_members (id) on delete set null,
  target_email     text,
  target_user_id   uuid,
  action           text not null,
  previous_value   jsonb,
  new_value        jsonb,
  result           text not null default 'success' check (result in ('success', 'failure')),
  created_at       timestamptz not null default now()
);

create index team_audit_log_workspace_idx on public.team_audit_log (workspace_id, created_at desc);

alter table public.team_audit_log enable row level security;

grant select, insert on public.team_audit_log to service_role;
revoke all on public.team_audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. handle_new_user() — admit into a pending, inactive row only
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

  -- is_active = false: becoming an active member now requires the owner to
  -- explicitly approve (see /api/team/invitations/approve) once the invitee
  -- has set a password and the invitation has moved to 'awaiting_approval'
  -- (see /api/team/invitations/complete). This trigger never activates
  -- anyone and never touches invitations.status itself anymore.
  insert into public.workspace_members (workspace_id, user_id, role, created_by, is_active)
  values (v_inv.workspace_id, new.id, v_inv.role, v_inv.invited_by, false);

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
