-- Fairway CRM — B11: per-record scope for Sales Rep on leads and tasks.
--
-- Confirmed gap from the RBAC audit: every tenant-table write policy (B1)
-- grants 'sales_rep' the same workspace-wide access as 'owner'/'admin' —
-- current_workspace_role(workspace_id) in (...) alone, with no owner_id/
-- assignee_id check. A sales rep could read and write every other rep's
-- leads and tasks. This migration scopes 'sales_rep' (only) to rows they
-- own/are assigned, on leads and tasks (the two tables that represent an
-- individually-assignable unit of work). Owner and admin are unaffected —
-- both keep full workspace-wide access, exactly as before.
--
-- Companies, contacts, and activities deliberately stay workspace-shared:
-- they're reference/history data routinely cross-referenced by leads owned
-- by different reps (e.g. one company with leads split across two reps),
-- so owner-scoping them would risk breaking legitimate shared lookups
-- rather than closing a real gap.
--
-- An unassigned row (owner_id/assignee_id is null) is hidden from a sales
-- rep entirely, per the explicit requirement that they cannot access
-- "restricted or unassigned records" — only an owner/admin can assign one,
-- after which it becomes visible to that rep.

create or replace function public.current_member_id(w uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.workspace_members m
  where m.workspace_id = w
    and m.user_id = auth.uid()
    and m.is_active
  limit 1;
$$;

do $$
declare
  t text;
  owner_col text;
begin
  foreach t in array array['leads', 'tasks']
  loop
    owner_col := case t when 'tasks' then 'assignee_id' else 'owner_id' end;

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);

    execute format(
      'create policy %I_select on public.%I
         for select using (
           public.is_workspace_member(workspace_id)
           and (
             public.current_workspace_role(workspace_id) <> ''sales_rep''
             or %I = public.current_member_id(workspace_id)
           )
         )',
      t, t, owner_col
    );
    execute format(
      'create policy %I_insert on public.%I
         for insert with check (
           public.current_workspace_role(workspace_id) in (''owner'', ''admin'')
           or (
             public.current_workspace_role(workspace_id) = ''sales_rep''
             and %I = public.current_member_id(workspace_id)
           )
         )',
      t, t, owner_col
    );
    execute format(
      'create policy %I_update on public.%I
         for update using (
           public.current_workspace_role(workspace_id) in (''owner'', ''admin'')
           or (
             public.current_workspace_role(workspace_id) = ''sales_rep''
             and %I = public.current_member_id(workspace_id)
           )
         )
         with check (
           public.current_workspace_role(workspace_id) in (''owner'', ''admin'')
           or (
             public.current_workspace_role(workspace_id) = ''sales_rep''
             and %I = public.current_member_id(workspace_id)
           )
         )',
      t, t, owner_col, owner_col
    );
    execute format(
      'create policy %I_delete on public.%I
         for delete using (
           public.current_workspace_role(workspace_id) in (''owner'', ''admin'')
           or (
             public.current_workspace_role(workspace_id) = ''sales_rep''
             and %I = public.current_member_id(workspace_id)
           )
         )',
      t, t, owner_col
    );
  end loop;
end;
$$;
