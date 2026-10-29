-- 60: cross-workspace ownership integrity.
-- Verifies the composite FKs added by 20261022130000_b1_security_remediation.sql
-- reject a record that names a member of a different workspace, while keeping
-- nullable ownership and member-deletion semantics working.
-- Requires 10_setup.sql.
do $$
declare
  a_ws     uuid;
  a_member uuid;
  b_ws     uuid;
  b_member uuid;
  lead_id  uuid;
  n        int;
begin
  -- Surface deferred-FK violations at end of statement so they can be caught
  -- here instead of at COMMIT. If a statement passes under IMMEDIATE it also
  -- passes under the production DEFERRED setting.
  set constraints all immediate;

  select w.id into a_ws
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';
  assert a_ws is not null, 'precondition: workspace A exists';

  select m.id into a_member
  from public.workspace_members m
  where m.workspace_id = a_ws
    and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert a_member is not null, 'precondition: membership A exists';

  -- Rep Two's OWN workspace (distinct from A's, which they are also in).
  select w.id into b_ws
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000002' and m.role = 'owner';
  assert b_ws is not null and b_ws <> a_ws, 'precondition: distinct workspace B';

  select m.id into b_member
  from public.workspace_members m
  where m.workspace_id = b_ws
    and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000002';
  assert b_member is not null, 'precondition: membership B exists';

  select id into lead_id from public.leads where workspace_id = a_ws and company_name = 'A Co';
  assert lead_id is not null, 'precondition: lead A Co exists';

  ------------------------------------------------------------------ leads.owner_id
  begin
    insert into public.leads (workspace_id, company_name, owner_id)
    values (a_ws, 'cross-ws owner', b_member);
    raise exception 'POLICY BUG: cross-workspace leads.owner_id was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS leads.owner_id rejects a member of another workspace';
  end;

  insert into public.leads (workspace_id, company_name, owner_id)
  values (a_ws, 'same-ws owner', a_member);
  raise notice 'PASS leads.owner_id accepts a member of the same workspace';

  insert into public.leads (workspace_id, company_name, owner_id)
  values (a_ws, 'null owner', null);
  raise notice 'PASS leads.owner_id still accepts NULL';

  ------------------------------------------------------------ leads.created_by
  begin
    update public.leads set created_by = b_member
    where workspace_id = a_ws and company_name = 'same-ws owner';
    raise exception 'POLICY BUG: cross-workspace leads.created_by was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS leads.created_by rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- companies.owner_id
  begin
    insert into public.companies (workspace_id, name, owner_id)
    values (a_ws, 'cross-ws co', b_member);
    raise exception 'POLICY BUG: cross-workspace companies.owner_id was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS companies.owner_id rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- contacts.owner_id
  begin
    insert into public.contacts (workspace_id, name, owner_id)
    values (a_ws, 'cross-ws contact', b_member);
    raise exception 'POLICY BUG: cross-workspace contacts.owner_id was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS contacts.owner_id rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- tasks.assignee_id
  begin
    insert into public.tasks (workspace_id, title, assignee_id)
    values (a_ws, 'cross-ws task', b_member);
    raise exception 'POLICY BUG: cross-workspace tasks.assignee_id was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS tasks.assignee_id rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- activities.owner_id
  begin
    insert into public.activities (workspace_id, type, subject, owner_id)
    values (a_ws, 'note', 'cross-ws activity', b_member);
    raise exception 'POLICY BUG: cross-workspace activities.owner_id was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS activities.owner_id rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- lead_imports.imported_by
  begin
    insert into public.lead_imports (workspace_id, imported_by, status, total_rows)
    values (a_ws, b_member, 'processing', 0);
    raise exception 'POLICY BUG: cross-workspace lead_imports.imported_by was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS lead_imports.imported_by rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- lead_score_events.created_by
  begin
    insert into public.lead_score_events (workspace_id, lead_id, score, computed_by, created_by)
    values (a_ws, lead_id, 42, 'system', b_member);
    raise exception 'POLICY BUG: cross-workspace lead_score_events.created_by was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS lead_score_events.created_by rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- workspace_members.created_by
  begin
    insert into public.workspace_members (workspace_id, user_id, role, created_by)
    values (a_ws, 'bbbbbbbb-0000-4000-8000-000000000009', 'viewer', b_member);
    raise exception 'POLICY BUG: cross-workspace workspace_members.created_by was accepted';
  exception when foreign_key_violation then
    raise notice 'PASS workspace_members.created_by rejects a member of another workspace';
  end;

  ---------------------------------------------------------------- member deletion still works
  -- The composite FK must not break the original `on delete set null`
  -- semantics: removing a member clears references instead of failing.
  insert into auth.users (id, email, raw_user_meta_data)
  values ('cccccccc-0000-4000-8000-00000000000a', 'scratch-member@example.com', '{"full_name":"Scratch Member"}')
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (a_ws, 'cccccccc-0000-4000-8000-00000000000a', 'sales_rep')
  returning id into b_member;  -- reuse the variable name as scratch

  update public.leads set owner_id = b_member
  where workspace_id = a_ws and company_name = 'same-ws owner';

  delete from public.workspace_members where id = b_member;

  select count(*) into n from public.leads
  where workspace_id = a_ws and company_name = 'same-ws owner' and owner_id is null;
  assert n = 1, 'owner_id should be nulled when the member is deleted';
  raise notice 'PASS member deletion still nulls ownership instead of failing';

  raise notice 'ALL CROSS-WORKSPACE TESTS PASSED';
end $$;
