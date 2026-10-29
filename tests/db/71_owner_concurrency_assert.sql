-- 71: concurrent last-owner changes, assertion.
-- The runner raced two transactions, each deleting one of Conc A's two owners.
-- Serialisation on the workspaces row must let exactly one succeed; without it
-- both would pass the "another owner exists" check and the workspace would be
-- left with zero owners.
select
  case when (select count(*) from public.workspace_members wm
             join public.workspaces w on w.id = wm.workspace_id
             where w.name = 'Conc A''s workspace' and wm.role = 'owner') = 1
       then 'PASS concurrent owner removal left exactly one owner'
       else 'FAIL concurrent owner removal left zero owners (or too many)'
  end as concurrency_result,
  (select count(*) from public.workspace_members wm
   join public.workspaces w on w.id = wm.workspace_id
   where w.name = 'Conc A''s workspace') as total_members;
