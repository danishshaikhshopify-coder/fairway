-- Corrected expectations: B is a MEMBER of Owner One's workspace, so B
-- legitimately sees both leads. Outsider 0006 belongs to no shared workspace
-- and must see nothing.
set role authenticated;

set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000002"}';
do $$
declare n int;
begin
  select count(*) into n from public.leads where company_name = 'A Co';
  assert n = 1, format('B is a member of A''s workspace, should see A Co, got %s', n);
  select count(*) into n from public.leads where company_name = 'B Co';
  assert n = 1, format('B should see own lead, got %s', n);
  select count(*) into n from public.leads;
  assert n = 2, format('B should see exactly 2 leads (own + A''s), got %s', n);
  raise notice 'PASS B sees own workspace + shared workspace, nothing else';
end $$;

reset role;
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000006"}';
do $$
declare n int;
begin
  select count(*) into n from public.leads;
  assert n = 0, format('outsider must see 0 leads, got %s', n);
  select count(*) into n from public.workspaces;
  assert n = 1, format('outsider should see 1 workspace, got %s', n);
  select count(*) into n from public.pipeline_stages;
  assert n = 6, format('outsider should see only own 6 stages, got %s', n);
  raise notice 'PASS outsider sees nothing foreign';
end $$;

-- Co-members can read each other's profiles; non-co-members cannot.
reset role;
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000003"}';
do $$
declare n int;
begin
  select count(*) into n from public.profiles
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert n = 1, format('viewer should read co-member profile, got %s', n);
  select count(*) into n from public.profiles
  where id = 'aaaaaaaa-0000-4000-8000-000000000006';
  assert n = 0, format('viewer must NOT read non-co-member profile, got %s', n);
  select count(*) into n from public.profiles
  where id = 'aaaaaaaa-0000-4000-8000-000000000006' or id = auth.uid();
  assert n = 1, format('viewer always sees self only, got %s', n);
  raise notice 'PASS profiles visibility is workspace-scoped';
end $$;
reset role;

-- Cross-workspace leak check: A must never see Outsider's workspace rows.
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}';
do $$
declare n int;
begin
  select count(*) into n from public.workspaces
  where name like '%Outsider%';
  assert n = 0, format('A must not see outsider workspace, got %s', n);
  select count(*) into n from public.workspaces;
  assert n = 1, format('A should see exactly 1 workspace, got %s', n);
  raise notice 'PASS A isolated from foreign workspaces';
end $$;
reset role;
