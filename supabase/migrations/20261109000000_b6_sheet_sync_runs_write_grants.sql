-- Fairway CRM — B6: let manual Sheets sync runs write their own audit rows.
--
-- sync.ts's module header documents the real design: "the caller supplies
-- a Supabase client (user session for manual runs, service role for
-- scheduled runs)" — and the manual sync route (/api/integrations/
-- google-sheets/sync) does exactly that, passing the signed-in user's own
-- session client into runSheetSync().
--
-- But B3 (20261031160000_b3_sheets_integration.sql) only granted `select`
-- on sheet_sync_runs to `authenticated`, with a comment assuming only the
-- service role would ever write there. startRun()/finishRun() insert and
-- update that table on every run, so every manual dry-run/apply click was
-- failing with 42501 "permission denied for table sheet_sync_runs" before
-- it ever reached Google Sheets or the CRM tables. This closes that gap
-- with the same workspace-membership scoping the existing select policy
-- already uses.
--
-- No table, column or row-data change. Grants + two RLS policies only.

grant insert, update on public.sheet_sync_runs to authenticated;

create policy sheet_sync_runs_insert on public.sheet_sync_runs
  for insert with check (public.is_workspace_member(workspace_id));

create policy sheet_sync_runs_update on public.sheet_sync_runs
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
