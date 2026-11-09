-- Fairway CRM — B5: missing table-level grants on the original B1 schema.
--
-- Found applying migrations to the hosted project for the first time: every
-- core table created in 20261022120000_b1_schema.sql (workspaces, profiles,
-- workspace_members, companies, contacts, lead_sources, pipeline_stages,
-- lead_imports, leads, tasks, activities, lead_score_events) has RLS
-- policies but was NEVER granted table-level privileges to `authenticated`
-- or `service_role`. RLS policies only narrow access that a GRANT already
-- allows — without the GRANT, every query returns 42501 "permission denied"
-- regardless of role or policy. The later B3/B4 migrations (integration
-- tables) got this right; B1 did not.
--
-- No table, column, policy or row-data change. Grants only.

grant select, update on public.workspaces        to authenticated;
grant select, update on public.profiles           to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select on public.lead_score_events to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'contacts', 'lead_sources', 'pipeline_stages',
    'lead_imports', 'leads', 'tasks', 'activities'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- service_role bypasses RLS but still needs ordinary table grants in
-- Postgres; this project does not appear to have Supabase's usual default
-- privilege set applied, so every table gets it explicitly.
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspaces', 'profiles', 'workspace_members', 'companies', 'contacts',
    'lead_sources', 'pipeline_stages', 'lead_imports', 'leads', 'tasks',
    'activities', 'lead_score_events', 'integration_connections',
    'sheet_sync_runs', 'gmail_connections'
  ]
  loop
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;
