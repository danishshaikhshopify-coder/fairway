-- ============================================================================
-- B1 corrective migration: whitespace-normalised duplicate guards.
--
-- WHY A NEW FILE: 20261022120000_b1_schema.sql may already have been applied
-- elsewhere (an applied migration is immutable), so the three unique indexes
-- below are dropped and recreated here rather than edited in place. Correct
-- both on a database that has run the original and on a fresh
-- `supabase db reset` that runs all migrations back to back.
--
-- WHAT CHANGED AND WHY: the original guards compared lower(value) only, so
-- values differing solely in surrounding whitespace were treated as distinct
-- ("Acme " vs "Acme", "x@y.com " vs "x@y.com"). The application already
-- compares trim().toLowerCase() (companies name, contacts email, lead dup
-- detection), so the database guard now matches it via btrim().
--
-- SCOPE: three index definitions only. No table, column, RLS policy, or API
-- change, and no row data is touched. On a database that already contains
-- whitespace-variant duplicates, index creation fails loudly and the rows must
-- be merged first.
-- ============================================================================

drop index public.companies_workspace_name_unique_idx;
create unique index companies_workspace_name_unique_idx
  on public.companies (workspace_id, lower(btrim(name)));

drop index public.lead_sources_workspace_name_unique_idx;
create unique index lead_sources_workspace_name_unique_idx
  on public.lead_sources (workspace_id, lower(btrim(name)));

-- The partial predicate moves from `email <> ''` to `btrim(email) <> ''` so it
-- stays consistent with the new expression: a whitespace-only email would
-- normalise to '' and otherwise collide with a genuinely empty email, while
-- NULL stays excluded exactly as before.
drop index public.contacts_workspace_email_unique_idx;
create unique index contacts_workspace_email_unique_idx
  on public.contacts (workspace_id, lower(btrim(email)))
  where btrim(email) <> '';
