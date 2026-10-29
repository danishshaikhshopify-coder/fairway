-- An admin must NOT be able to promote themselves to owner.
set role authenticated;
set request.jwt.claims to '{"sub":"aaaaaaaa-0000-4000-8000-000000000005"}';

update public.workspace_members
set role = 'owner'
where user_id = auth.uid()
  and workspace_id in (
    select w.id from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where m.user_id = auth.uid() and m.role = 'admin'
  );
\echo UNREACHABLE
