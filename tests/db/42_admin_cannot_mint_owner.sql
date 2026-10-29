-- An admin must NOT be able to mint a new 'owner' (privilege escalation).
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}';

do $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, 'aaaaaaaa-0000-4000-8000-000000000006', 'owner'
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid() and m.role = 'admin';
end $$;
\echo UNREACHABLE
