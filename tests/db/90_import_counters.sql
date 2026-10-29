-- 90: import counter integrity.
-- Verifies the relationship between lead_imports.total_rows, created_rows and
-- failed_rows added by 20261022130000_b1_security_remediation.sql, and confirms
-- the pre-existing non-negative checks still hold.
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

  ------------------------------------------------------------------ negative counters
  begin
    insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
    values (a_ws, 'completed', -1, 0, 0);
    raise exception 'POLICY BUG: negative total_rows accepted';
  exception when check_violation then
    raise notice 'PASS negative total_rows rejected';
  end;

  begin
    insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
    values (a_ws, 'completed', 10, 3, -1);
    raise exception 'POLICY BUG: negative failed_rows accepted';
  exception when check_violation then
    raise notice 'PASS negative failed_rows rejected';
  end;

  ------------------------------------------------------------------ pending
  insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
  values (a_ws, 'processing', 10, 0, 0);
  raise notice 'PASS pending import (nothing processed yet) accepted';

  ------------------------------------------------------------------ partially processed
  insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
  values (a_ws, 'processing', 10, 6, 2);
  raise notice 'PASS partially processed import accepted (2 rows still pending)';

  ------------------------------------------------------------------ completed, all rows accounted for
  insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
  values (a_ws, 'completed', 10, 9, 1);
  raise notice 'PASS completed import with created+failed == total accepted';

  ------------------------------------------------------------------ completed, rows skipped
  -- There is no skipped counter, so created+failed may legitimately be below
  -- total at completion. Forcing equality would make this state impossible.
  insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
  values (a_ws, 'completed', 10, 7, 1);
  raise notice 'PASS completed import with skipped rows accepted';

  ------------------------------------------------------------------ failed mid-run
  insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
  values (a_ws, 'failed', 10, 3, 0);
  raise notice 'PASS import that failed mid-run accepted';

  ------------------------------------------------------------------ over-counting
  begin
    insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
    values (a_ws, 'completed', 10, 9, 2);
    raise exception 'POLICY BUG: created+failed > total_rows accepted';
  exception when check_violation then
    raise notice 'PASS created_rows + failed_rows > total_rows rejected';
  end;

  begin
    insert into public.lead_imports (workspace_id, status, total_rows, created_rows, failed_rows)
    values (a_ws, 'processing', 4, 6, 0);
    raise exception 'POLICY BUG: created_rows > total_rows accepted';
  exception when check_violation then
    raise notice 'PASS created_rows > total_rows rejected';
  end;

  select count(*) into n from public.lead_imports where workspace_id = a_ws;
  assert n = 5, format('expected exactly 5 valid import rows, got %s', n);
  raise notice 'ALL IMPORT COUNTER TESTS PASSED';
end $$;
