-- Idempotent fixtures. Runs as superuser (bypasses RLS).
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.com',   '{"full_name":"Owner One"}'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'rep@example.com',     '{"full_name":"Rep Two"}'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'viewer@example.com',  '{"full_name":"Viewer Three"}'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'salesrep@example.com', '{"full_name":"Salesrep Four"}'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'admin@example.com',   '{"full_name":"Admin Five"}'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'outsider@example.com', '{"full_name":"Outsider Six"}')
on conflict (id) do nothing;

create temp view a_ws as
  select w.id
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner';

-- B/C/D/E membership in A's workspace (in addition to their own).
insert into public.workspace_members (workspace_id, user_id, role)
select (select id from a_ws), u.uid::uuid, u.role
from (values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'sales_rep'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'viewer'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'sales_rep'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'admin')
) as u(uid, role)
on conflict (workspace_id, user_id) do nothing;

-- One lead in A's workspace, one in B's own workspace.
insert into public.leads (workspace_id, company_name, status, score, fit_score, qualification, value)
select (select id from a_ws), 'A Co', 'new', 50, 40, 'Pending', 1000
where not exists (select 1 from public.leads where company_name = 'A Co');

insert into public.leads (workspace_id, company_name, status, score, fit_score, qualification, value)
select w.id, 'B Co', 'new', 70, 60, 'Pending', 2000
from public.workspaces w
join public.workspace_members m on m.workspace_id = w.id
where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000002' and m.role = 'owner'
  and not exists (select 1 from public.leads where company_name = 'B Co');

drop view a_ws;
\echo 'FIXTURES OK'
