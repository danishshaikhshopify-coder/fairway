-- 80: lead score event attribution.
-- Verifies log_lead_score_event() records the authenticated actor, never the
-- lead owner, and leaves created_by null when there is no usable actor.
-- Requires 10_setup.sql.
do $$
declare
  a_ws         uuid;
  a_owner_mem  uuid;
  salesrep_mem uuid;
  v_lead       uuid;
  n            int;
begin
  select w.id into a_ws
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';
  assert a_ws is not null, 'precondition: workspace A';

  select m.id into a_owner_mem from public.workspace_members m
  where m.workspace_id = a_ws and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  select m.id into salesrep_mem from public.workspace_members m
  where m.workspace_id = a_ws and m.user_id = 'aaaaaaaa-0000-4000-8000-000000000004';
  assert a_owner_mem is not null and salesrep_mem is not null, 'precondition: both memberships';

  insert into public.leads (workspace_id, company_name, owner_id, score)
  values (a_ws, 'Attribution Lead', a_owner_mem, 10)
  returning id into v_lead;

  ------------------------------------------------------------------ actor is the editor, not the owner
  set role authenticated;
  set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}';

  update public.leads set score = 80 where id = v_lead;
  reset role;
  reset request.jwt.claims;

  select count(*) into n from public.lead_score_events e
  where e.lead_id = v_lead and e.score = 80 and e.created_by = salesrep_mem;
  assert n = 1, format('expected 1 event attributed to the editing rep, got %s', n);

  select count(*) into n from public.lead_score_events e
  where e.lead_id = v_lead and e.score = 80 and e.created_by = a_owner_mem;
  assert n = 0, 'event must NOT be attributed to the lead owner when someone else edited';
  raise notice 'PASS score event attributes the authenticated actor, not the lead owner';

  ------------------------------------------------------------------ no authenticated actor
  -- Superuser context: auth.uid() is null, so the event is explicitly
  -- system-generated. The lead owner must not be substituted.
  update public.leads set score = 20 where id = v_lead;

  select count(*) into n from public.lead_score_events e
  where e.lead_id = v_lead and e.score = 20 and e.created_by is null;
  assert n = 1, format('expected 1 system event with null created_by, got %s', n);

  select count(*) into n from public.lead_score_events e
  where e.lead_id = v_lead and e.score = 20 and e.created_by = a_owner_mem;
  assert n = 0, 'system event must not fall back to the lead owner';
  raise notice 'PASS system-generated event leaves created_by null instead of guessing';

  ------------------------------------------------------------------ still read-only for clients
  set role authenticated;
  set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000004"}';
  begin
    update public.lead_score_events set created_by = null where lead_id = v_lead;
    raise exception 'POLICY BUG: clients can rewrite score history';
  exception when insufficient_privilege then
    raise notice 'PASS score history stays immutable from the client';
  end;
  reset role;
  reset request.jwt.claims;

  raise notice 'ALL ATTRIBUTION TESTS PASSED';
end $$;
