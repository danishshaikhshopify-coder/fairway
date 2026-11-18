-- Fairway CRM — B9: distinguish "removed" from "merely deactivated".
--
-- is_active alone cannot tell a fully-removed member (Remove button: access
-- revoked AND the Supabase Auth account banned) apart from one the owner
-- just flipped off with the Active switch (access revoked, account not
-- banned, meant to be a quick toggle back). Both leave is_active = false.
-- The owner needs to see them in different places (the main roster's
-- switch vs. a separate Removed Members list with a re-invite action), and
-- re-inviting a removed email has to unban/re-enable sign-in before the
-- fresh-auth step can run — which would otherwise make a removed row look
-- "merely deactivated" again for the brief window before they accept.
-- removed_at is the one unambiguous signal for which bucket a row is in,
-- independent of that timing.

alter table public.workspace_members
  add column removed_at timestamptz;

-- Backfill: anyone already removed via the old Remove flow (is_active =
-- false and their Auth account currently banned — the only signal that
-- existed before this column) must not come back as "merely deactivated".
-- Without this, each of them would reappear in the main roster with a live
-- Active switch, letting the owner flip them straight back to is_active =
-- true with no re-invite and no fresh authentication at all.
update public.workspace_members m
set removed_at = now()
from auth.users u
where u.id = m.user_id
  and m.is_active = false
  and u.banned_until is not null
  and u.banned_until > now();

-- shares_workspace_with() (b1) gates the profiles read policy and was never
-- patched alongside is_workspace_member()/current_workspace_role() in b7,
-- which added `and m.is_active` so tenant-table RLS revokes immediately on
-- removal/deactivation. Without the same guard here, a removed member whose
-- session/JWT is still unexpired (or any still-`is_active=false` deactivated
-- row) can keep reading a co-member's profile — including a removed row
-- reading an active co-member's, or the reverse — via `mine`/`theirs` either
-- side having is_active = false. Both sides now require it.
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
      and mine.is_active
      and exists (
        select 1
        from public.workspace_members theirs
        where theirs.workspace_id = mine.workspace_id
          and theirs.user_id = other_user
          and theirs.is_active
      )
  );
$$;

-- gmail_connections' 4 policies (b1) gate on a raw `member_id in (select ...
-- where user_id = auth.uid())` subquery instead of is_workspace_member(), so
-- they never got b7's `is_active` guard either — unlike every other tenant
-- table. gmail_connections stores the OAuth access_token/refresh_token in
-- plain columns, so this is not just a stale-read: a removed member's
-- still-unexpired JWT (bans only block *new* tokens, not ones already
-- issued) could still select/update/delete their own row — including
-- reading their own stored Gmail refresh_token — for as long as that JWT
-- stays valid after removal. Re-create all 4 with the same is_active guard
-- the other tenant tables already have.
drop policy if exists gmail_connections_select on public.gmail_connections;
create policy gmail_connections_select on public.gmail_connections
  for select using (
    member_id in (
      select workspace_members.id
      from public.workspace_members
      where workspace_members.user_id = auth.uid()
        and workspace_members.is_active
    )
  );

drop policy if exists gmail_connections_insert on public.gmail_connections;
create policy gmail_connections_insert on public.gmail_connections
  for insert with check (
    member_id in (
      select workspace_members.id
      from public.workspace_members
      where workspace_members.user_id = auth.uid()
        and workspace_members.is_active
    )
  );

drop policy if exists gmail_connections_update on public.gmail_connections;
create policy gmail_connections_update on public.gmail_connections
  for update using (
    member_id in (
      select workspace_members.id
      from public.workspace_members
      where workspace_members.user_id = auth.uid()
        and workspace_members.is_active
    )
  )
  with check (
    member_id in (
      select workspace_members.id
      from public.workspace_members
      where workspace_members.user_id = auth.uid()
        and workspace_members.is_active
    )
  );

drop policy if exists gmail_connections_delete on public.gmail_connections;
create policy gmail_connections_delete on public.gmail_connections
  for delete using (
    member_id in (
      select workspace_members.id
      from public.workspace_members
      where workspace_members.user_id = auth.uid()
        and workspace_members.is_active
    )
  );
