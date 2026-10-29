-- ============================================================================
-- B1 corrective migration: cross-workspace integrity, last-owner protection,
-- score-event attribution, import counter integrity.
--
-- WHY A NEW FILE: 20261022120000_b1_schema.sql may already have been applied
-- elsewhere (the repo has no commits yet, so its applied state cannot be
-- proven from history). An applied migration is immutable; every fix below is
-- additive so this file is correct both on a database that has run the
-- original and on a fresh `supabase db reset` that runs them back to back.
--
-- SCOPE: schema/integrity only. No RLS policy changes, no API surface changes.
-- ============================================================================

-- ============================================================================
-- 1. Cross-workspace ownership integrity
-- ============================================================================
-- The original migration referenced workspace_members(id) alone from nine
-- ownership columns. Nothing at the DB level stopped a lead in workspace A
-- from naming an owner who is only a member of workspace B: RLS scopes rows
-- by workspace_id, but the owner_id value itself was unconstrained.
--
-- Fix: a composite foreign key pairing the row's workspace_id with the
-- ownership column, targeting a new unique (workspace_id, id) key.
--
-- WHY THE OLD SINGLE-COLUMN FKs STAY: they carry `on delete set null`, which
-- keeps member deletion (and the auth.users -> profiles cascade) working.
-- Composite FKs cannot express `set null` for only one column -- SET NULL
-- nulls every column in the key, which would violate workspace_id not null.
-- So the composite key below is added as NO ACTION / DEFERRABLE INITIALLY
-- DEFERRED, layered on top of the existing ones:
--   * the existing single-column FK nulls the ownership column when the
--     member is deleted, so the composite key no longer matches and the
--     delete succeeds;
--   * DEFERRABLE removes any dependence on which RI trigger Postgres runs
--     first. A plain non-deferred composite FK also permits that delete on
--     PostgreSQL 17 today, but only because the single-column SET NULL action
--     happens to fire before the composite check -- an implementation detail,
--     not a guarantee. Deferring the check to COMMIT makes the ordering
--     irrelevant.
--   * it still rejects any committed cross-workspace reference, and since
--     each PostgREST request is its own transaction the rejection surfaces on
--     the same request that caused it.
--
-- Nullable ownership is unaffected: MATCH SIMPLE (the default) treats a NULL
-- ownership column as satisfied, so owner_id/assignee_id/created_by staying
-- nullable keeps working.

alter table public.workspace_members
  add constraint workspace_members_workspace_id_id_key unique (workspace_id, id);

-- Ownership columns -> workspace_members, paired with their workspace_id.
-- Every one of these is nullable in the original schema; MATCH SIMPLE keeps
-- that behaviour.
alter table public.workspace_members
  add constraint workspace_members_created_by_workspace_fkey
  foreign key (workspace_id, created_by)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.companies
  add constraint companies_owner_workspace_fkey
  foreign key (workspace_id, owner_id)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.contacts
  add constraint contacts_owner_workspace_fkey
  foreign key (workspace_id, owner_id)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.lead_imports
  add constraint lead_imports_imported_by_workspace_fkey
  foreign key (workspace_id, imported_by)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.leads
  add constraint leads_owner_workspace_fkey
  foreign key (workspace_id, owner_id)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.leads
  add constraint leads_created_by_workspace_fkey
  foreign key (workspace_id, created_by)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.tasks
  add constraint tasks_assignee_workspace_fkey
  foreign key (workspace_id, assignee_id)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.activities
  add constraint activities_owner_workspace_fkey
  foreign key (workspace_id, owner_id)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

alter table public.lead_score_events
  add constraint lead_score_events_created_by_workspace_fkey
  foreign key (workspace_id, created_by)
  references public.workspace_members (workspace_id, id)
  on delete no action deferrable initially deferred;

-- ============================================================================
-- 2. Last-owner protection
-- ============================================================================
-- Blocking an owner from being deleted or demoted must not also block the two
-- legitimate paths that remove owners:
--   * deleting a workspaces row cascades to its members;
--   * deleting an auth.users row cascades to profiles, which cascides to
--     workspace_members.
-- Both are allowed below by detecting that the parent row is already gone.
--
-- CONCURRENCY: all owner changes for a workspace are serialised on a row lock
-- of that workspace. Two concurrent demotions of a two-owner workspace both
-- observe "another owner exists" only if they run unserialised; with the lock
-- the second waits, then re-reads and correctly sees the last owner.

create or replace function public.prevent_last_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws       uuid;
  v_exclude  uuid;
  v_others   bigint;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
    v_ws      := old.workspace_id;
    v_exclude := old.id;
  else
    if old.role <> 'owner' then
      return new;
    end if;
    -- Still an owner of the same workspace: nothing is lost.
    if new.role = 'owner' and new.workspace_id = old.workspace_id then
      return new;
    end if;
    -- Demoted, or moved to another workspace: the old workspace loses an owner.
    v_ws      := old.workspace_id;
    v_exclude := old.id;
  end if;

  -- Serialise owner changes for this workspace. Also detects deletion of the
  -- workspace itself: the cascading member deletes run after the workspaces
  -- row is already gone, so this finds nothing and the change is allowed.
  perform 1 from public.workspaces where id = v_ws for update;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Profile already gone means the account is being torn down
  -- (auth.users -> profiles -> workspace_members). Preserve that lifecycle:
  -- the user is not "leaving" the workspace, their login is being removed.
  if not exists (select 1 from public.profiles where id = old.user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*)
  into v_others
  from public.workspace_members
  where workspace_id = v_ws
    and role = 'owner'
    and id <> v_exclude;

  if v_others = 0 then
    raise exception 'workspace % would be left without an owner: refusing to % the last owner',
      v_ws,
      case when tg_op = 'DELETE' then 'delete' else 'demote' end
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger prevent_last_owner_change
  before delete or update on public.workspace_members
  for each row execute function public.prevent_last_owner_change();

-- Trigger-only function: not part of the API surface.
revoke execute on function public.prevent_last_owner_change() from public, anon, authenticated;

-- ============================================================================
-- 3. Lead score event attribution
-- ============================================================================
-- The original trigger wrote created_by = new.owner_id, i.e. it recorded the
-- lead's owner as the author of a change somebody else performed. That is a
-- false audit record: in a shared workspace any rep can edit any lead.
--
-- Policy:
--   created_by = the member row for auth.uid() in the SAME workspace as the
--                lead, when there is one.
--   created_by = NULL when there is no authenticated actor (service-role
--                jobs, migrations, background recompute) or when the actor is
--                not a member of this workspace. NULL is the explicit,
--                non-falsifying marker for "system-generated"; the lead owner
--                is never substituted.
--   computed_by = 'system' always. The row is written by this snapshot
--                trigger, not hand-entered; 'manual' and 'import' stay
--                available for rows written by other paths (e.g. an import
--                job inserting history directly).
-- Nothing here trusts client-supplied identity: auth.uid() comes from the
-- signed JWT claims, never from the row being written.

create or replace function public.log_lead_score_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
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
    -- Resolve the authenticated actor to a member of THIS workspace. auth.uid()
    -- is null outside a request (service role, migrations, cron), and a user
    -- with no membership row here resolves to null; both are left as null.
    if auth.uid() is not null then
      select m.id
      into v_actor
      from public.workspace_members m
      where m.workspace_id = new.workspace_id
        and m.user_id = auth.uid();
    end if;

    insert into public.lead_score_events (
      workspace_id, lead_id, score, fit_score, qualification,
      evidence, follow_up_evidence, recommended_action,
      computed_by, created_by
    ) values (
      new.workspace_id, new.id, new.score, new.fit_score, new.qualification,
      new.evidence, new.follow_up_evidence, new.recommended_action,
      'system', v_actor
    );
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 4. Import counter integrity
-- ============================================================================
-- total_rows/created_rows/failed_rows already carry non-negative checks. What
-- was missing is the relationship between them.
--
-- Contract: created_rows + failed_rows <= total_rows. You cannot have
-- processed more rows than the file contained. This stays true for every
-- legitimate state:
--   pending             total=10 created=0  failed=0
--   partially processed total=10 created=6  failed=2  (2 still pending)
--   completed           total=10 created=9  failed=1
--   completed, skipped  total=10 created=7  failed=1  (2 duplicates skipped)
--   failed mid-run      total=10 created=3  failed=0
-- It does NOT require created+failed = total at completion: there is no
-- skipped counter, and duplicate rows are dropped without being counted as
-- either, so forcing equality would make a real completed state impossible.
--
-- A streaming import that does not know the file size up front satisfies this
-- too, as long as total_rows is kept at >= rows attempted so far.

alter table public.lead_imports
  add constraint lead_imports_processed_within_total_check
  check (created_rows + failed_rows <= total_rows);
