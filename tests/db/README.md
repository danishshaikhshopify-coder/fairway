# Database tests

Plain-SQL assertion scripts for the B1 schema and its corrective migrations.
These are **not** pgTAP tests, so `supabase test db` does not run them.

## Running

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests\db\run.ps1
```

The runner creates a throwaway `postgres:17` container, applies
`00_auth_shim.sql`, applies the migrations in order, then runs each file
below in sequence. The container is destroyed at the end, pass or fail.
Nothing here contacts a remote Supabase project.

## Shimmed PostgreSQL vs. real Supabase Auth

Every result these tests produce is against **shimmed PostgreSQL**, not real
Supabase Auth. `00_auth_shim.sql` supplies only what the migrations need:

- an `auth` schema with an `auth.users` table and an `auth.uid()` that reads
  the `request.jwt.claims` GUC, mirroring Supabase's behaviour closely enough
  for the RLS helpers and the signup trigger;
- the `anon`, `authenticated` and `service_role` roles.

What the shim does **not** reproduce:

- GoTrue's real signup flow, JWT signing, or refresh behaviour. Test 20 proves
  the signup trigger ignores client-supplied metadata, but it inserts into
  `auth.users` directly rather than going through GoTrue.
- `service_role` in the shim is a plain `nologin bypassrls` role with no key
  handling behind it.
- Supabase's managed grants and API role setup. Grants here are the minimum
  the tests need.

So: the migration applies cleanly to stock PostgreSQL 17 and all integrity and
RLS behaviour holds. A real `supabase db reset` against live Supabase Auth is
still untested and should be run before deploying.

## Files

| File | Covers |
| --- | --- |
| `00_auth_shim.sql` | Local auth shim. Not a repo migration; the runner applies it first. |
| `10_setup.sql` | Fixtures: six users, one shared workspace, two leads. |
| `20_bootstrap_and_signup_security.sql` | Signup trigger creates profile + personal workspace; hostile metadata grants nothing. |
| `30_rls_isolation.sql` | Workspace and profile reads are scoped to membership. |
| `41_viewer_cannot_write.sql` | `viewer` is excluded from every write policy. |
| `42_admin_cannot_mint_owner.sql` | Negative test: admin cannot create an `owner`. |
| `43_admin_cannot_self_promote.sql` | Negative test: admin cannot promote themselves. |
| `44_score_events_not_client_writable.sql` | Negative test: no client insert on `lead_score_events`. |
| `45_score_events_immutable.sql` | Negative test: no client update on `lead_score_events`. |
| `50_writes_and_history.sql` | `sales_rep` writes; score history snapshots; workspace cascade. |
| `60_cross_workspace_ownership.sql` | Composite FKs reject members of another workspace. |
| `70_last_owner_guard.sql` | Last owner cannot be deleted or demoted; lifecycle paths preserved. |
| `71_owner_concurrency_setup.sql` | Fixture for the concurrency race. |
| `71_owner_concurrency_assert.sql` | Asserts exactly one owner survives the race. |
| `80_score_attribution.sql` | Score events record the actor, not the lead owner. |
| `90_import_counters.sql` | `created_rows + failed_rows <= total_rows`; counters non-negative. |
| `95_uniqueness_trim.sql` | Duplicate guards reject case/whitespace variants of names and emails. |

`42`–`45` are negative tests: the runner treats a non-zero psql exit as the
passing outcome and fails the run if the statement is *not* rejected.

## The concurrency test

`run.ps1` opens two connections against a workspace with exactly two owners
and deletes one owner from each, 400ms apart, each inside its own transaction.
The last-owner guard takes a row lock on the `workspaces` row, so the second
transaction blocks, re-reads after the first commits, and is refused. Without
that lock both would pass the "another owner exists" check and the workspace
would be left with zero owners. The run fails unless exactly one of the two
transactions is refused and exactly one owner remains.
