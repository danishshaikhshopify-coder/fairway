-- Viewer must be denied writes in a workspace where they hold 'viewer'.
-- Target workspace is chosen by NAME (Owner One's workspace), not by role,
-- so the caller is guaranteed to hold only 'viewer' there.
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}';

do $$
declare
  n int;
  ws uuid;
begin
  -- confirm we hold viewer in this workspace
  select w.id into ws from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.name = 'Owner One''s workspace' and m.user_id = auth.uid() and m.role = 'viewer';
  assert ws is not null, 'precondition: caller should hold viewer here';

  -- READ is allowed
  select count(*) into n from public.leads where workspace_id = ws;
  raise notice 'viewer can READ % rows', n;

  -- WRITE must be denied
  begin
    insert into public.leads (workspace_id, company_name)
    values (ws, 'viewer must not create this');
    raise exception 'POLICY BUG: viewer insert was ALLOWED';
  exception when insufficient_privilege or check_violation or insufficient_resources then
    raise notice 'PASS viewer INSERT denied (%: %)', sqlstate, sqlerrm;
  end;

  begin
    update public.leads set company_name = 'tampered' where workspace_id = ws;
    if found then
      raise exception 'POLICY BUG: viewer update was ALLOWED';
    end if;
    raise notice 'PASS viewer UPDATE denied (0 rows)';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS viewer UPDATE denied (%: %)', sqlstate, sqlerrm;
  end;

  begin
    delete from public.leads where workspace_id = ws;
    if found then
      raise exception 'POLICY BUG: viewer delete was ALLOWED';
    end if;
    raise notice 'PASS viewer DELETE denied (0 rows)';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS viewer DELETE denied (%: %)', sqlstate, sqlerrm;
  end;
end $$;
reset role;
