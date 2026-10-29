-- 71: concurrent last-owner changes, fixture.
-- Gives workspace "Conc A" exactly two owners so the runner can race two
-- transactions against them. Requires the remediation migration in place.
insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-4000-8000-000000000030', 'conc-a@example.com', '{"full_name":"Conc A"}'),
  ('eeeeeeee-0000-4000-8000-000000000031', 'conc-b@example.com', '{"full_name":"Conc B"}')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, 'eeeeeeee-0000-4000-8000-000000000031', 'owner'
from public.workspaces w
join public.workspace_members m on m.workspace_id = w.id
where m.user_id = 'eeeeeeee-0000-4000-8000-000000000030' and m.role = 'owner'
on conflict (workspace_id, user_id) do nothing;

-- Fixture is only valid if both owners really are in place.
select
  case when (select count(*) from public.workspace_members wm
             join public.workspaces w on w.id = wm.workspace_id
             where w.name = 'Conc A''s workspace' and wm.role = 'owner') = 2
       then 'FIXTURE OK: Conc A has exactly two owners'
       else 'FIXTURE FAILED: expected two owners' end;
