-- Fairway CRM — Google Sheets sync, Phase 1 (lossless schema).
--
-- Adds the columns needed to preserve every mapped field from the lead-gen
-- team's "CRM SYSTEM" spreadsheet (BACKUP_BEFORE_CRM tab) without losing the
-- social-handle data: company socials + a company's "perfect client"
-- reference, and owner (contact) socials. No RLS changes — the existing
-- per-row policies on companies/contacts already cover these new columns.
--
-- Also registers "Google Sheets" as a lead source: for every existing
-- workspace here, and for every future workspace via handle_new_user().

alter table public.companies
  add column instagram_url      text,
  add column facebook_url       text,
  add column linkedin_url       text,
  add column perfect_client_url text;

alter table public.contacts
  add column linkedin_url  text,
  add column instagram_url text,
  add column facebook_url  text;

insert into public.lead_sources (workspace_id, name, is_system)
select w.id, 'Google Sheets', true
from public.workspaces w
where not exists (
  select 1 from public.lead_sources s
  where s.workspace_id = w.id and s.name = 'Google Sheets'
);

-- Re-declare with "Google Sheets" added so new workspaces get it too. Same
-- body as b1_schema.sql otherwise (see that file for the security notes).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text;
  v_ws_name  text;
  v_ws_slug  text;
  v_ws_id    uuid;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, full_name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  v_ws_name := v_name || '''s workspace';
  v_ws_slug := left(rtrim(regexp_replace(lower(v_ws_name), '[^a-z0-9]+', '-', 'g'), '-'), 40)
               || '-' || left(md5(new.id::text || random()::text), 8);

  insert into public.workspaces (name, slug)
  values (v_ws_name, v_ws_slug)
  returning id into v_ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, new.id, 'owner');

  insert into public.pipeline_stages (workspace_id, key, label, position, kind)
  values
    (v_ws_id, 'new',       'New',       1, 'open'),
    (v_ws_id, 'contacted', 'Contacted', 2, 'open'),
    (v_ws_id, 'qualified', 'Qualified', 3, 'open'),
    (v_ws_id, 'proposal',  'Proposal',  4, 'open'),
    (v_ws_id, 'won',       'Won',       5, 'won'),
    (v_ws_id, 'lost',      'Lost',      6, 'lost');

  insert into public.lead_sources (workspace_id, name, is_system)
  values
    (v_ws_id, 'Website',       true),
    (v_ws_id, 'Referral',      true),
    (v_ws_id, 'Trade show',    true),
    (v_ws_id, 'Cold call',     true),
    (v_ws_id, 'Partner',       true),
    (v_ws_id, 'Social',        true),
    (v_ws_id, 'Google Sheets', true);

  return new;
end;
$$;
