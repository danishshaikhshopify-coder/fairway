-- lead_score_events is append-only via trigger: no direct client INSERT.
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}';

insert into public.lead_score_events (workspace_id, lead_id, score, computed_by)
select w.id, l.id, 99, 'manual'
from public.workspaces w
join public.workspace_members m on m.workspace_id = w.id
join public.leads l on l.workspace_id = w.id
where m.user_id = auth.uid() and m.role = 'owner'
limit 1;
\echo UNREACHABLE
