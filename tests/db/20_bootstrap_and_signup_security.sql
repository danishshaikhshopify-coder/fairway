-- Signup trigger bootstrap + the malicious-metadata security case.
do $$
declare
  n int;
  a_ws uuid;
  h_ws_owner_role text;
begin
  -- every signup gets a profile
  assert (select count(*) from public.profiles) = 6,
    'expected 6 profiles';

  -- every signup gets exactly one personal workspace with themselves as sole owner
  assert (select count(*) from public.workspaces) = 6, 'expected 6 workspaces';

  -- default board columns + sources seeded per workspace
  select count(*) into n from public.pipeline_stages;
  assert n = 36, format('expected 36 pipeline_stages, got %s', n);

  select count(*) into n from public.lead_sources;
  assert n = 36, format('expected 36 lead_sources, got %s', n);

  select w.id into a_ws from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';

  -- owner's workspace has the full 6-stage board in order
  select count(*) into n from public.pipeline_stages where workspace_id = a_ws;
  assert n = 6, format('expected 6 stages for owner ws, got %s', n);

  raise notice 'PASS bootstrap';
end $$;

-- SECURITY CASE: a signup whose client metadata claims an existing workspace
-- and the owner role must NOT gain access to that workspace.
insert into auth.users (id, email, raw_user_meta_data)
values (
  'aaaaaaaa-0000-4000-8000-0000000000ff',
  'attacker@example.com',
  json_build_object(
    'full_name', 'Attacker',
    'workspace_id', (select w.id from public.workspaces w
                     join public.workspace_members m on m.workspace_id = w.id
                     where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role='owner'),
    'role', 'owner'
  )::jsonb
);

do $$
declare
  a_ws uuid;
  n int;
begin
  select w.id into a_ws from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';

  select count(*) into n from public.workspace_members
  where workspace_id = a_ws and user_id = 'aaaaaaaa-0000-4000-8000-0000000000ff';
  assert n = 0, 'FAIL: attacker was added to the victim workspace';

  -- attacker got their OWN workspace, owner of that only
  select count(*) into n from public.workspace_members
  where user_id = 'aaaaaaaa-0000-4000-8000-0000000000ff' and role = 'owner';
  assert n = 1, format('expected attacker to own exactly 1 workspace, got %s', n);

  raise notice 'PASS signup metadata cannot grant foreign workspace or extra role';
end $$;
