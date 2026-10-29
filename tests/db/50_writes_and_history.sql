-- sales_rep CAN write; score history trigger appends snapshots; cascade FKs.
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}';

do $$
declare
  ws uuid;
  lead uuid;
  n  int;
  before_n int;
  after_n  int;
begin
  select w.id into ws from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.name = 'Owner One''s workspace' and m.user_id = auth.uid() and m.role = 'sales_rep';
  assert ws is not null, 'precondition: caller holds sales_rep here';

  -- sales_rep INSERT allowed
  begin
    insert into public.leads (workspace_id, company_name, status)
    values (ws, 'Rep created lead', 'new')
    returning id into lead;
    raise notice 'PASS sales_rep INSERT allowed';
  exception when insufficient_privilege or check_violation then
    raise exception 'POLICY BUG: sales_rep insert denied (%: %)', sqlstate, sqlerrm;
  end;

  -- sales_rep UPDATE allowed
  begin
    update public.leads set status = 'contacted' where id = lead;
    raise notice 'PASS sales_rep UPDATE allowed';
  exception when insufficient_privilege or check_violation then
    raise exception 'POLICY BUG: sales_rep update denied (%: %)', sqlstate, sqlerrm;
  end;

  -- score change appends exactly one history row
  select count(*) into before_n from public.lead_score_events where lead_id = lead;
  assert before_n = 0, format('expected 0 history rows before, got %s', before_n);

  update public.leads set score = 77, fit_score = 55, qualification = 'Qualified'
  where id = lead;

  select count(*) into after_n from public.lead_score_events where lead_id = lead;
  assert after_n = 1,
    format('expected 1 history row after score change, got %s', after_n);

  -- snapshot must be explainable: values recorded alongside the change
  assert exists (
    select 1 from public.lead_score_events
    where lead_id = lead and score = 77 and fit_score = 55
      and qualification = 'Qualified' and computed_by = 'system'
  ), 'history snapshot must capture score/fit/qualification with computed_by=system';

  raise notice 'PASS lead score history snapshot written';

  -- a non-scoring update must NOT append a second history row
  update public.leads set company_name = 'renamed' where id = lead;
  select count(*) into after_n from public.lead_score_events where lead_id = lead;
  assert after_n = 1,
    format('non-scoring update must not append history, got %s', after_n);
  raise notice 'PASS non-scoring update appends no history';

  -- further score change appends another row (append-only audit trail)
  update public.leads set score = 10 where id = lead;
  select count(*) into after_n from public.lead_score_events where lead_id = lead;
  assert after_n = 2, format('expected 2 history rows, got %s', after_n);
  raise notice 'PASS history accumulates in order';

  -- sales_rep can DELETE their own workspace rows (allowed by design)
  delete from public.leads where id = lead;
  select count(*) into n from public.leads where id = lead;
  assert n = 0, 'lead should be deleted';
  raise notice 'PASS sales_rep DELETE allowed';
end $$;
reset role;

-- Cascade: deleting a workspace removes all its rows (verified as superuser).
do $$
declare
  victim uuid;
  n int;
begin
  select w.id into victim from public.workspaces w
  where w.name = 'Outsider Six''s workspace';
  assert victim is not null, 'need a victim workspace';

  insert into public.companies (workspace_id, name) values (victim, 'Cascade Co');
  insert into public.leads (workspace_id, company_name)
  values (victim, 'Cascade Lead');

  select count(*) into n from public.leads where workspace_id = victim;
  assert n = 1, 'precondition: lead exists';

  delete from public.workspaces where id = victim;

  select count(*) into n from public.workspaces where id = victim;
  assert n = 0, 'workspace deleted';
  select count(*) into n from public.leads where workspace_id = victim;
  assert n = 0, format('leads should cascade, got %s', n);
  select count(*) into n from public.companies where workspace_id = victim;
  assert n = 0, format('companies should cascade, got %s', n);
  select count(*) into n from public.workspace_members where workspace_id = victim;
  assert n = 0, format('members should cascade, got %s', n);
  raise notice 'PASS workspace delete cascades to all tenant rows';
end $$;
