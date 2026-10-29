-- 95: whitespace-normalised duplicate guards.
-- Verifies 20261024100000_b1_uniqueness_trim.sql: company names, lead source
-- names and contact emails that differ only by case or surrounding whitespace
-- are duplicates; genuinely distinct values and email-less contacts still fit.
-- Requires 10_setup.sql.
do $$
declare
  a_ws uuid;
  n    int;
begin
  select w.id into a_ws
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';
  assert a_ws is not null, 'precondition: workspace A';

  ------------------------------------------------------------------ companies
  insert into public.companies (workspace_id, name)
  values (a_ws, 'Pine Valley Test Co');

  begin
    insert into public.companies (workspace_id, name)
    values (a_ws, '  pine valley test co  ');
    raise exception 'POLICY BUG: case+whitespace company variant accepted';
  exception when unique_violation then
    raise notice 'PASS company name variant (case+whitespace) rejected';
  end;

  begin
    insert into public.companies (workspace_id, name)
    values (a_ws, 'Pine Valley Test Co ');
    raise exception 'POLICY BUG: trailing-space company variant accepted';
  exception when unique_violation then
    raise notice 'PASS company name variant (trailing space) rejected';
  end;

  insert into public.companies (workspace_id, name)
  values (a_ws, 'Pine Valley Test Co East');
  raise notice 'PASS distinct company name accepted';

  ------------------------------------------------------------------ lead sources
  insert into public.lead_sources (workspace_id, name)
  values (a_ws, 'Referral Program');

  begin
    insert into public.lead_sources (workspace_id, name)
    values (a_ws, ' referral program ');
    raise exception 'POLICY BUG: case+whitespace lead source variant accepted';
  exception when unique_violation then
    raise notice 'PASS lead source name variant rejected';
  end;

  insert into public.lead_sources (workspace_id, name)
  values (a_ws, 'Referral Program 2027');
  raise notice 'PASS distinct lead source name accepted';

  ------------------------------------------------------------------ contacts email
  insert into public.contacts (workspace_id, name, email)
  values (a_ws, 'A. Tester', 'a.tester@example.com');

  begin
    insert into public.contacts (workspace_id, name, email)
    values (a_ws, 'B. Tester', ' A.Tester@Example.com ');
    raise exception 'POLICY BUG: case+whitespace email variant accepted';
  exception when unique_violation then
    raise notice 'PASS contact email variant (case+whitespace) rejected';
  end;

  insert into public.contacts (workspace_id, name, email)
  values (a_ws, 'C. Tester', 'b.tester@example.com');
  raise notice 'PASS distinct contact email accepted';

  -- Email-less contacts stay outside the guard: NULL and whitespace-only
  -- values are excluded by the partial predicate, exactly as '' was before.
  insert into public.contacts (workspace_id, name, email)
  values (a_ws, 'No Email One', null);
  insert into public.contacts (workspace_id, name, email)
  values (a_ws, 'No Email Two', '   ');
  raise notice 'PASS null and whitespace-only contact emails permitted';

  ------------------------------------------------------------------ counts
  select count(*) into n from public.companies
   where workspace_id = a_ws and name like 'Pine Valley Test Co%';
  assert n = 2, format('expected 2 distinct companies, got %s', n);

  select count(*) into n from public.lead_sources
   where workspace_id = a_ws and name like 'Referral Program%';
  assert n = 2, format('expected 2 distinct lead sources, got %s', n);

  select count(*) into n from public.contacts where workspace_id = a_ws;
  assert n = 4, format('expected 4 contacts (2 addressed + 2 email-less), got %s', n);

  raise notice 'ALL UNIQUENESS TRIM TESTS PASSED';
end $$;
