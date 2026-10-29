-- 70: last-owner protection.
-- Verifies public.prevent_last_owner_change() (20261022130000_b1_security_
-- remediation.sql) blocks deletion/demotion of a workspace's final owner,
-- while preserving workspace deletion and account teardown.
-- Runs as superuser so the trigger is isolated from RLS.
do $$
declare
  ws_x     uuid;
  ws_y     uuid;
  ws_z     uuid;
  m_x      uuid;
  m_y_in_x uuid;
  m_z_in_x uuid;
  n        int;
begin
  -- Three throwaway signups. handle_new_user() gives each its own workspace
  -- and an owner membership row.
  insert into auth.users (id, email, raw_user_meta_data) values
    ('dddddddd-0000-4000-8000-000000000020', 'x-lastowner@example.com', '{"full_name":"X Lastowner"}'),
    ('dddddddd-0000-4000-8000-000000000021', 'y-lastowner@example.com', '{"full_name":"Y Lastowner"}'),
    ('dddddddd-0000-4000-8000-000000000022', 'z-lastowner@example.com', '{"full_name":"Z Lastowner"}')
  on conflict (id) do nothing;

  select w.id into ws_x from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'dddddddd-0000-4000-8000-000000000020' and m.role = 'owner';
  select w.id into ws_y from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'dddddddd-0000-4000-8000-000000000021' and m.role = 'owner';
  select w.id into ws_z from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'dddddddd-0000-4000-8000-000000000022' and m.role = 'owner';
  assert ws_x is not null and ws_y is not null and ws_z is not null, 'precondition: three workspaces';

  select id into m_x from public.workspace_members
  where workspace_id = ws_x and user_id = 'dddddddd-0000-4000-8000-000000000020';
  assert m_x is not null, 'precondition: X membership row';

  ------------------------------------------------------------------ sole owner delete
  begin
    delete from public.workspace_members where id = m_x;
    raise exception 'POLICY BUG: sole owner was deleted';
  exception when check_violation then
    raise notice 'PASS deleting the last owner is refused';
  end;

  ------------------------------------------------------------------ sole owner demote
  begin
    update public.workspace_members set role = 'viewer' where id = m_x;
    raise exception 'POLICY BUG: sole owner was demoted';
  exception when check_violation then
    raise notice 'PASS demoting the last owner is refused';
  end;

  -- Move to a second owner so the remaining cases have somewhere to go.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_x, 'dddddddd-0000-4000-8000-000000000021', 'owner')
  returning id into m_y_in_x;
  select count(*) into n from public.workspace_members
  where workspace_id = ws_x and role = 'owner';
  assert n = 2, format('precondition: two owners expected, got %s', n);

  ------------------------------------------------------------------ one of two owners
  delete from public.workspace_members where id = m_y_in_x;
  select count(*) into n from public.workspace_members
  where workspace_id = ws_x and role = 'owner';
  assert n = 1, format('expected one owner after removing a second, got %s', n);
  raise notice 'PASS deleting an owner is allowed while another owner remains';

  ------------------------------------------------------------------ last one again
  -- Re-add Y, then remove X, leaving Y as sole owner of ws_x.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_x, 'dddddddd-0000-4000-8000-000000000021', 'owner')
  returning id into m_y_in_x;
  delete from public.workspace_members where id = m_x;
  select count(*) into n from public.workspace_members
  where workspace_id = ws_x and role = 'owner';
  assert n = 1, format('expected one owner, got %s', n);

  begin
    delete from public.workspace_members where id = m_y_in_x;
    raise exception 'POLICY BUG: last owner of ws_x was deleted';
  exception when check_violation then
    raise notice 'PASS deleting the last owner of a two-owner workspace is refused after the first is gone';
  end;

  ------------------------------------------------------------------ non-owner rows are never blocked
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_x, 'dddddddd-0000-4000-8000-000000000022', 'viewer');
  select id into m_z_in_x from public.workspace_members
  where workspace_id = ws_x and user_id = 'dddddddd-0000-4000-8000-000000000022';
  delete from public.workspace_members where id = m_z_in_x;
  select count(*) into n from public.workspace_members where id = m_z_in_x;
  assert n = 0, 'viewer membership should be deletable';
  raise notice 'PASS deleting a non-owner member is still allowed';

  ------------------------------------------------------------------ promotion is allowed
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_x, 'dddddddd-0000-4000-8000-000000000022', 'viewer');
  select id into m_z_in_x from public.workspace_members
  where workspace_id = ws_x and user_id = 'dddddddd-0000-4000-8000-000000000022';
  update public.workspace_members set role = 'owner' where id = m_z_in_x;
  raise notice 'PASS promoting a member to owner is allowed';

  ------------------------------------------------------------------ workspace deletion is preserved
  delete from public.workspaces where id = ws_y;
  select count(*) into n from public.workspaces where id = ws_y;
  assert n = 0, 'workspace deletion should still work';
  select count(*) into n from public.workspace_members where workspace_id = ws_y;
  assert n = 0, 'membership rows should cascade with the workspace';
  raise notice 'PASS deleting a whole workspace still works';

  ------------------------------------------------------------------ account teardown is preserved
  -- Deleting auth.users cascades to profiles, then to workspace_members. By
  -- the time the membership row is removed the profile row is already gone,
  -- which the trigger treats as account teardown rather than a membership
  -- change. Z is the sole owner of ws_z, so this must not be refused.
  delete from auth.users where id = 'dddddddd-0000-4000-8000-000000000022';
  select count(*) into n from public.workspace_members where workspace_id = ws_z;
  assert n = 0, 'account teardown should remove the membership';
  select count(*) into n from public.workspaces where id = ws_z;
  assert n = 1, 'account teardown must not delete the workspace';
  raise notice 'PASS deleting a user account still works for the last owner';

  raise notice 'ALL LAST-OWNER TESTS PASSED';
end $$;
