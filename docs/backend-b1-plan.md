# Fairway CRM — Backend Phase B1 Plan (Planning Only)

Status: **design document, nothing implemented**. No schema was created, no SDK
installed, no migration written or modified. Implementation is a separate,
explicitly approved step (Phase B2).

## 1. Current state (inspected 2026-10-22)

| Item | State |
|---|---|
| `package.json` | Next 16.4.2, React 19.3.0. **No** Supabase SDK, no auth libs |
| `supabase/config.toml` | CLI-generated defaults: Postgres **17**, auth enabled, `site_url = http://127.0.0.1:3000`, local API port 54321 |
| `supabase/.temp/` | Project already **linked** to a hosted Supabase project (CLI metadata only; contents not copied here) |
| `supabase/migrations/20261022102536_initial_schema.sql` | Exists but is **empty (0 bytes)**. Left untouched — B2 adds new timestamped migrations alongside it |
| `supabase/seed.sql` | Does not exist yet (referenced by config) |
| `.env.example` | Names only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` |
| App data layer | `src/lib/types.ts` unions + `src/lib/crm-store.tsx` session state; no API routes, no auth, no DB code |

Frontend domain shapes the schema must serve (from `src/lib/types.ts`):
`Lead` (status ×6, source ×6, businessType ×3, scores 0–100, value, owner,
dates, evidence/qualification/recommendation), `Company` (type, location
USA/Canada/Mexico, fitScore, notes), `Contact`, `Task` (priority ×3, type ×5,
done), `Activity` (type ×5). Owners are currently plain strings → become
`workspace_members` references.

## 2. Goals and non-goals for B1

**Goals**
- Multi-tenant workspace model with membership and roles
- Tables + RLS for every entity the frontend already renders
- Auth flow: signup → profile + personal workspace (owner), session handling in Next.js
- Migration path that keeps the mock UI working while real data lands behind it

**Non-goals (deferred, with reasons)**
- Separate `deals` entity — frontend models one object (lead = deal); see §5.6
- Soft delete / audit trail of edits — add when a customer need appears
- Realtime subscriptions, storage buckets (avatars), CSV import UI, email/invites
- SQL aggregation views — current volumes are computed client-side fine

## 3. Client/SDK choices (to install in B2, not now)

- `@supabase/supabase-js` + `@supabase/ssr` — cookie-based session bridge for the App Router (server components, route handlers, middleware)
- Browser client: anon key only. Server client: service-role key, used solely in route handlers / auth callbacks — never imported into client components
- No ORM: schema lives in migrations; queries stay explicit

## 4. Entity overview

```
auth.users ──< profiles (1:1)
     │
     └──< workspace_members >── workspaces ──< companies
                                    │              ├──< contacts
                                    │              ├──< leads >─ lead_sources
                                    │              │     ├──< tasks        (lead/company/contact links)
                                    │              │     ├──< activities   (lead/company/contact links)
                                    │              │     ├──< lead_score_events (history)
                                    │              │     └──< lead_imports
                                    └──< pipeline_stages (per-workspace labels/positions)
```

Every tenant table carries `workspace_id uuid not null references workspaces(id) on delete cascade`
and is RLS-scoped to it. ids are `uuid default gen_random_uuid()` everywhere
(no sequential ids exposed to the client).

**Composite foreign keys (review §13.1):** every child→parent reference inside
the tenant tables (`leads.company_id`, `leads.contact_id`, `leads.source_id`,
`leads.owner_id`, `leads.created_by`, `leads.import_id`, `contacts.company_id`,
`contacts.owner_id`, `tasks`/`activities` link columns, `*.assignee_id`,
`*.owner_id`) must be declared as composite `(workspace_id, <id>)` pairs, with
the parent tables carrying `unique (workspace_id, id)`. Bare-id FKs + RLS only
prevent *reading* cross-workspace rows; they do not prevent *writing* a row
whose `workspace_id` is the actor's own but whose FK points at another
workspace's record. The plain `references X(id)` wording in §5.4–§5.12 is
shorthand — implement as composite pairs.

## 5. Table designs

Conventions: `created_at timestamptz not null default now()`,
`updated_at timestamptz not null default now()` maintained by one shared
`set_updated_at()` trigger. `value`/money: `numeric(12,2)`. Score columns:
`smallint check (value between 0 and 100)`.

### 5.1 workspaces
- `id` pk, `name text not null`, `slug text not null unique` (generation must be collision-proof — see review §13.3)
- `region text not null default ''` — the Settings screen edits "Region focus" (`src/app/settings/page.tsx:66`)
- `country text not null default 'USA' check (country in ('USA','Canada','Mexico'))`
- `currency text not null default 'USD' check (currency in ('USD','CAD','MXN'))`
- `fiscal_start_month smallint not null default 1 check (between 1 and 12)`
- `default_owner_id uuid references workspace_members(id) on delete set null` — Settings "Default lead owner" (`settings/page.tsx:78`)
- `default_follow_up_days smallint not null default 3 check (between 1 and 30)` — Settings "follow-up window" (`settings/page.tsx:80`)
- RLS: member **select**; **update restricted to owner/admin** (review §13.2 — the earlier "members-only update" wording was unsafe); deletion: owner-only, B2

### 5.2 profiles
- `id uuid pk references auth.users(id) on delete cascade`
- `full_name text not null default ''`, `avatar_url text`, `timezone text not null default 'America/Chicago'`
- `notification_prefs jsonb not null default '{"newLeadAlerts":true,"dailyDigest":true,"overdueReminders":true,"weeklyReport":false}'::jsonb` — Settings Notifications tab (`settings/page.tsx:70-74`); alternative: 4 boolean columns, decide in B2
- Email stays in `auth.users` — no duplication
- RLS: readable by co-members **through the definer helper** (a direct subquery on `workspace_members` recurses — review §13.6); self-writable

### 5.3 workspace_members
- `id` pk, `workspace_id` fk, `user_id uuid not null references profiles(id) on delete cascade` (review §13.5 — cascade required, otherwise deleting an auth user aborts on membership rows)
- `role text not null default 'sales_rep' check (role in ('owner','admin','sales_rep','viewer'))`
- `created_by uuid references workspace_members(id) on delete set null`, `created_at`
- **unique (workspace_id, user_id)**; index on `user_id` (workspace lookup per session)
- RLS: select for co-members; **insert/update/delete policies exist only in owner/admin-scoped form — never a general member-level `with check` policy on this table** (review §13.2: any member would otherwise be able to insert themselves as `owner`)

### 5.4 companies
- `id` pk, `workspace_id` fk, `name text not null`
- `business_type text not null default 'Seller' check (in ('Seller','Installer','Both'))`
- `city text`, `region text`, `country text not null default 'USA' check (in ('USA','Canada','Mexico'))`
- `website text`, `email text`, `phone text`, `fit_score smallint check (0..100)`,
  `notes text not null default ''`
- `owner_id uuid references workspace_members(id) on delete set null`
- **unique (workspace_id, lower(name))** — duplicate guard for the directory
- Indexes: `(workspace_id, country)`, `(workspace_id, business_type)`, `(workspace_id, fit_score desc)`

### 5.5 contacts
- `id` pk, `workspace_id` fk, `company_id uuid references companies(id) on delete cascade`
- `name text not null`, `title text not null default ''`, `email text`, `phone text`,
  `owner_id` fk set null
- Partial **unique (workspace_id, lower(email)) where email <> ''**
- Indexes: `(workspace_id, company_id)`, `(workspace_id, lower(name))`

### 5.6 leads (also the deals — see rationale)
- `id` pk, `workspace_id` fk
- `company_id uuid references companies(id) on delete set null` — nullable on
  purpose: the Add-Lead form creates a lead before a company record exists;
  the denormalized `company_name` below keeps standalone leads renderable
- `company_name text not null`, `contact_name text not null default ''`,
  `contact_id uuid references contacts(id) on delete set null`,
  `email text`, `phone text` — matches the current frontend exactly
- `source_id uuid references lead_sources(id) on delete set null` — nullable,
  but the frontend `Lead.source` is a non-nullable literal (`types.ts:46`); the
  API layer must always resolve a display source (system sources should be
  deletion-protected — review §13.7)
- `status text not null default 'new' check (in ('new','contacted','qualified','proposal','won','lost'))`
- `business_type text not null default 'Seller' check (in ('Seller','Installer','Both'))`
- `value numeric(12,2) not null default 0 check (value >= 0)`, `currency text not null default 'USD'`
- `score smallint check (0..100)`, `fit_score smallint check (0..100)`
- `qualification text not null default 'Pending' check (in ('Qualified','Needs review','Pending','Disqualified'))`
- `evidence text not null default ''`, `follow_up_evidence text not null default ''`,
  `recommended_action text not null default ''` — current snapshot (what Lead Intelligence renders)
- `owner_id uuid references workspace_members(id) on delete set null`
- `last_contact date`, `next_follow_up date`, `closed_at timestamptz`
- `import_id uuid references lead_imports(id) on delete set null`
- `created_by uuid references workspace_members(id)`, timestamps
- Indexes: `(workspace_id, status)`, `(workspace_id, owner_id)`,
  `(workspace_id, next_follow_up) where status not in ('won','lost')` (overdue queries),
  `(workspace_id, created_at desc)`, `(workspace_id, lower(company_name))`

**Why no separate `deals` table in B1:** the frontend pipeline, reports and
store all model a single object (lead carries status + value + stage). A
lead→deal split would force an API translation layer for zero current
benefit. Ceiling: if multi-offer deals per company appear, add `deals`
referencing `lead_id` and move `value`/`status` there; `leads` keeps
qualification. Documented so the split is a known upgrade path, not a surprise.

### 5.7 pipeline_stages (per-workspace labels & order)
- `id` pk, `workspace_id` fk, `key text not null check (in ('new','contacted','qualified','proposal','won','lost'))`
- `label text not null`, `position smallint not null`, `kind text not null check (in ('open','won','lost'))`
- **unique (workspace_id, key)**, **unique (workspace_id, position)**
- `leads.status` stays the enum-like text column; stages only customize
  labels/order shown in the UI. Keeps frontend types stable while making the
  board configurable. Seed one default set per workspace (trigger, §7).

### 5.8 lead_sources
- `id` pk, `workspace_id` fk, `name text not null`
- **unique (workspace_id, lower(name))**, `is_system boolean not null default false`
- Seeded with the six values the frontend knows (`Website`, `Referral`,
  `Trade show`, `Cold call`, `Partner`, `Social`)

### 5.9 tasks
- `id` pk, `workspace_id` fk, `title text not null`, `due_date date`,
  `priority text not null default 'medium' check (in ('low','medium','high'))`,
  `type text not null default 'follow-up' check (in ('call','email','meeting','follow-up','admin'))`,
  `is_done boolean not null default false`, `completed_at timestamptz`
- Links: `lead_id`/`company_id`/`contact_id`, each `on delete cascade`
  (history-loss behavior on parent deletion is an open decision — review §13.8)
- `related_to text not null default ''` — **required for frontend parity**:
  `Task.relatedTo` is a mandatory free-text string (`types.ts:97`) that also
  holds values with no entity behind it, e.g. "Internal" (`mock-data.ts:246`).
  The FKs above are optional enrichment; the text column is what screens render
- `assignee_id uuid references workspace_members(id) on delete set null`
- Index: `(workspace_id, is_done, due_date)` (open/overdue list), `(workspace_id, assignee_id)`

### 5.10 activities (calls, emails, meetings, **notes**)
- `id` pk, `workspace_id` fk, `type text not null check (in ('call','email','meeting','note','follow-up'))`
- `subject text not null`, `body text not null default ''`
- `occurred_at timestamptz not null default now()`
- Links: `lead_id`/`company_id`/`contact_id` `on delete cascade`; `owner_id` set null
- `related_to text not null default ''` — same parity requirement as tasks
  (`Activity.relatedTo`, `types.ts:106`; the Activities screen searches it,
  `activities/page.tsx:83`)
- Indexes: `(workspace_id, occurred_at desc)`, `(workspace_id, lead_id, occurred_at desc)`
- Notes are `type='note'` here rather than a separate table — one timeline, one feed query

### 5.11 lead_score_events (scoring history)
- `id` pk, `workspace_id` fk, `lead_id uuid references leads(id) on delete cascade`
- `score smallint`, `fit_score smallint`, `qualification text`, `evidence text`,
  `follow_up_evidence text`, `recommended_action text`
- `computed_by text not null default 'manual' check (in ('manual','system','import'))`,
  `created_by uuid references workspace_members(id) on delete set null`, `created_at`
- Append-only (no update/delete policies). Appended by trigger on lead **insert
  and on update** (review §13.4 — the original "update only" version left the
  first score unaudited) whenever any of the six snapshot fields differs; `leads`
  keeps the current values for fast reads — history is for the "how did this
  score move" view

### 5.12 lead_imports (import tracking)
- `id` pk, `workspace_id` fk, `source_name text`, `file_name text`,
  `status text not null default 'processing' check (in ('processing','completed','failed'))`,
  `total_rows int default 0`, `created_rows int default 0`, `failed_rows int default 0`,
  `error_summary text`, `imported_by uuid`, `created_at`
- Import UI is B3; the table exists now so `leads.import_id` is not added twice

## 6. Enum strategy

Text + `check` constraints instead of native pg enums: simpler migrations
when values evolve (native enum alter in Postgres is clunkier) and the
PostgREST/TS mapping stays plain strings, matching the frontend unions in
`src/lib/types.ts` 1:1.

## 7. Triggers and functions

1. `set_updated_at()` — shared `before update` trigger for all tenant tables
2. `handle_new_user()` — `on auth.users after insert`: create `profiles` row,
   a personal `workspace` ("{name}'s workspace"), owner membership, default
   `pipeline_stages` (6 rows) and `lead_sources` (6 rows). Signup then works
   with zero app-side bootstrap code. **Safety requirements (review §13.3):**
   - The trigger fires as `supabase_auth_admin`, which has no rights on
     `public` — the function must be `security definer` owned by `postgres`
     (table owner), with `execute` granted to `supabase_auth_admin` and
     revoked from `public`, `anon`, `authenticated` (not callable by clients)
   - Runs inside the auth insert's transaction: any error aborts signup
     (all-or-nothing — intended), so the derived `workspaces.slug` must be
     collision-proof (email prefix + random suffix; `user_id`-based fallback
     when the provider supplies no email). A plain name/email-derived slug can
     collide and fail signups
   - `user_id` is always `new.id` from the auth row; role is always `'owner'`;
     nothing client-controllable enters the inserts (no privilege escalation)
3. `lead_score_event_log()` — fires on leads **insert and update**: on insert,
   snapshot the initial scores; on update, snapshot when any of `score`,
   `fit_score`, `qualification`, `evidence`, `follow_up_evidence`,
   `recommended_action` differs from the old row (review §13.4 — an
   update-only trigger left a lead's first score unaudited)
4. `current_workspace_role(w uuid) returns text` — `security definer stable`,
   same shape as §8's helper, returns the actor's role or `null`. **Referenced
   by §8 policies but missing from the original plan — must be defined** (review
   §13.2)
5. All functions: `security definer`, owner `postgres`, fully qualified
   references, `set search_path = ''` (hardened from the original
   `= public`; safe either way only because every reference is schema-qualified
   — review §13.6), `stable` where read-only; `revoke execute from public`
   then `grant ... to authenticated, service_role`

## 8. Row Level Security

One membership helper, used by every policy:

```sql
create function public.is_workspace_member(w uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = w and m.user_id = auth.uid()
  );
$$;
-- owner must be postgres (table owner) so the body bypasses RLS on
-- workspace_members; grant execute to authenticated, service_role only.
```

**Verified safe, with conditions (review §13.6):** `security definer` +
schema-qualified `public.workspace_members` + qualified `auth.uid()` + `stable`
are correct. No recursion: the function body reads `workspace_members` as the
table owner, whose RLS is bypassed — so even the `workspace_members` select
policy can call it without infinite recursion. Conditions to preserve at
implementation: (a) function owned by the table owner (`postgres`),
(b) `execute` never granted to `anon`/`authenticated` beyond read usage,
(c) any *other* policy that needs to read `workspace_members` or `profiles`
must also go through a definer helper — a plain subquery recurses.

- `alter table ... enable row level security` on **every** tenant table
- Default per-table policy shape for **CRM data tables** (companies, contacts,
  leads, tasks, activities, pipeline_stages, lead_sources, lead_imports,
  lead_score_events):
  `using (is_workspace_member(workspace_id))`,
  `with check (is_workspace_member(workspace_id))` — plus composite-FK
  integrity per §4 for cross-workspace links
- **Permissive-policy warning (review §13.2) — supersedes the original
  "layered on top" wording:** Postgres permissive policies are OR-ed, so
  adding a "select-only viewer policy" does not remove write rights granted by
  another permissive policy. `workspace_members` and `workspaces` must have
  **no general member-level write policy at all**; their insert/update/delete
  policies must each be role-scoped in one policy, e.g.
  `using (is_workspace_member(workspace_id) and current_workspace_role(workspace_id) in ('owner','admin'))`.
  Otherwise: any `sales_rep` could insert `(their workspace_id, any user_id,
  role='owner')` into `workspace_members` — privilege escalation.
- `viewer` role: achieved by simply **not** granting insert/update policies to
  viewers on the CRM tables (viewer gets select-only policies where the general
  write policies are role-scoped), never by adding a restrictive-looking
  permissive policy
- `lead_score_events`: select via membership, insert via trigger only (no
  client insert policy), no update/delete
- Service-role client bypasses RLS (server-only, for auth callbacks/imports)

## 9. Auth flow (Next.js)

- `@supabase/ssr` middleware refreshing session cookies on every request
- Login/signup pages calling `supabase.auth.signUp/signInWithPassword`
- First-login bootstrap handled entirely by trigger §7.2 — no client dance
- `owner_id`/`created_by` on new rows = current member id resolved server-side
  or from the session; the frontend's `OWNERS` strings map to member rows via
  a `workspace_members` ⨝ `profiles` join (display name)

## 10. Frontend → backend mapping notes (for B2, not done now)

- `crm-store.tsx` keeps its interface; only the implementations swap from
  `useState` seeds to Supabase queries (`select` with the indexes above)
- Mock-only fields map 1:1: `followUpEvidence`, `evidence`,
  `recommendedAction`, `qualification` are real columns — no data invented
- `relatedTo` on tasks/activities maps to the `related_to` text column (with
  FKs as optional enrichment) — review §13.5
- Owner strings (`Lead.owner` etc., the mock `OWNERS` list in `types.ts:164`)
  map to `workspace_members ⨝ profiles` display names; unresolvable owner
  (`owner_id` null after member deletion) renders as "Unassigned". A fresh
  workspace has exactly **one** member (the signed-up owner), so owner dropdowns
  will legitimately offer fewer options than the mock — expected, not a bug
- Lead `source` literal ↔ `lead_sources` joined by workspace-scoped name; the
  frontend's closed `LeadSource` union cannot represent custom sources yet —
  widening that type is a frontend task for B2 (review §13.9)
- `Lead.nextFollowUp === ""` (mock lost lead) ↔ SQL `null`; `lastContact` ↔
  `last_contact` date; `moveLead`'s `lastContact` bump (`crm-store.tsx:91`)
  becomes an API-side update
- Dashboard/Reports stay client-computed in B1 (no SQL views)
- Settings screen persistence needs the columns added in §5.1/§5.2 (region,
  default owner, follow-up days, notification prefs) — review §13.5

## 11. Migration & rollout strategy (B2)

1. Keep `20261022102536_initial_schema.sql` **as-is (empty — re-verified 0
   bytes on disk during review)**; add
   `supabase/migrations/<timestamp>_b1_schema.sql` (tables §5, triggers §7,
   RLS §8) and `supabase/migrations/<timestamp>_b1_seed.sql` (stage/source
   defaults are trigger-based; seed.sql for demo workspace data)
2. Migration-internal ordering: `workspaces`, `profiles`, `workspace_members`
   first; `lead_imports` **before** `leads` (leads carries `import_id`);
   composite `unique (workspace_id, id)` indexes on parents before the child
   FKs that reference them — review §13.10
3. `supabase db reset` locally to validate; then `supabase db push` to the
   linked project (explicit approval required)
4. Install `@supabase/supabase-js` + `@supabase/ssr`, add clients under
   `src/lib/supabase/`, wire middleware + auth pages, then flip
   `crm-store.tsx` from mock to live per-entity behind a single explicit
   adapter switch: live mode only when `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set (module-scope check; verified
   during review that **no file under `src/` reads any env var today**, so
   absent env vars keep the current mock behavior unchanged). The middleware
   must **no-op entirely in demo mode** — an auth-redirecting middleware would
   lock the env-less demo app out of every page (review §13.11)

## 12. Environment variables

Names already reserved in `.env.example` — **no new names needed for B1**:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client-safe),
`SUPABASE_SERVICE_ROLE_KEY` (server-only), `DATABASE_URL` (migrations),
`NEXT_PUBLIC_APP_URL`. Values are never printed, committed, or copied into
documents; `.env*` stays gitignored except `.env.example`.

---

## 13. Design review findings (2026-10-22, review-only pass)

Scope: this section records an independent review of §1–§12 against
`src/lib/types.ts`, `src/lib/mock-data.ts`, `src/lib/crm-store.tsx`,
`src/app/settings/page.tsx`, `src/app/tasks|activities|leads` screens, and the
on-disk Supabase setup. **Nothing in this plan is implemented** — no tables
exist, no migration was created or applied, no package was installed, no
commit was made. Statements corrected inline in §4, §5, §7, §8, §10, §11 are
flagged "(review …)" at the point of change.

### 13.1 Workspace isolation — verdict: sound model, one real hole (fixed inline)

Every tenant table carries a `NOT NULL workspace_id` FK to `workspaces`
(companies, contacts, leads, pipeline_stages, lead_sources, tasks, activities,
lead_score_events, lead_imports, workspace_members). `profiles` is correctly
global identity (auth-scoped), and `workspaces` is the tenant root.

**Risk (was: unmitigated):** RLS `with check (is_workspace_member(workspace_id))`
validates only the row's own `workspace_id`. With bare-id FKs, a member of
workspace A could insert a lead with `workspace_id = A` but
`company_id`/`contact_id`/`owner_id`/`source_id` pointing at rows of workspace
B — the FK passes (the row exists), RLS passes (actor's workspace is correct).
Read-side leakage is blocked (the embedded company row fails *its* RLS), but
the dangling cross-tenant reference pollutes integrity and would surface in
any `service_role` read or export. Same shape for `contacts.company_id`,
`tasks`/`activities` link columns, `leads.import_id`, `*.assignee_id`.

**Correction applied inline (§4):** composite FKs `(workspace_id, id)` with
`unique (workspace_id, id)` on every referenced parent. This is the standard
RLS-tenant pattern and closes the hole at the constraint level, not in app
code. `pipeline_stages` is already safe via `unique (workspace_id, key)` +
leads referencing by `status` text, but gains `unique (workspace_id, id)` for
consistency.

### 13.2 RLS helper & role gating — helper OK with conditions; two policy flaws fixed

Helper `is_workspace_member()`: `security definer` + schema-qualified table +
qualified `auth.uid()` + `stable` = correct. **No recursion**, because the
definer (table owner) bypasses RLS on `workspace_members` — even its own select
policy can call it. Conditions now stated inline (§7/§8): owner must be
`postgres`; `search_path` hardened to `''`; execute granted to
`authenticated` + `service_role`, revoked from `public`/`anon` (anon policy
evaluation then errors instead of silently returning false — acceptable, it
fails closed).

**Flaw 1 (high — privilege escalation, fixed inline §8):** the original §8 said
viewer "select-only policies layered on top" of a default member-level write
policy. Postgres permissive policies OR together — a layered policy never
removes rights. As written, the default
`with check (is_workspace_member(workspace_id))` INSERT policy on
`workspace_members` would let **any member insert a row granting themselves or
anyone `role='owner'`**. Correction: `workspace_members` and `workspaces` get
**no general member-level write policy**; write policies are role-scoped in a
single policy via `current_workspace_role()`; viewer read-only is achieved by
*not* granting viewers write policies, never by additive permissive policies.

**Flaw 2 (medium — undefined dependency, fixed inline §7.4):**
`current_workspace_role(w)` was referenced by §8 but never defined. It is now
an explicit function with the same definer/revocation requirements as the
membership helper.

**Verified:** `with check` on update re-evaluates, so changing a row's
`workspace_id` to a foreign workspace is blocked. `lead_score_events` has no
client insert/update/delete policies — trigger-only writes (definer) bypass
RLS correctly.

### 13.3 Signup bootstrap — design sound; three safety requirements added (§7.2)

Transactional: the `auth.users after insert` trigger runs inside the signup
transaction — profile, workspace, owner membership, 6 stages, 6 sources all
commit or none do. A bootstrap failure aborts signup (intended, but means the
slug must never collide). Requirements added inline: function must be
`security definer` owned by `postgres` because the trigger fires as
`supabase_auth_admin` (which has no `public` rights — without the definer
switch, **every signup would fail**); execute granted only to
`supabase_auth_admin`, revoked from clients (no client-callable escalation
path); `user_id` is always the new auth row's id and role always `'owner'` —
nothing client-controllable. Collision-proof slug generation (random suffix,
`user_id` fallback when the provider sends no email) replaces the implied
email-derived slug.

### 13.4 Scoring evidence & history — auditable after one correction

Snapshot on `leads` (score, fit_score, qualification, evidence,
follow_up_evidence, recommended_action) = exactly what Lead Intelligence
renders (`lead-intelligence/page.tsx` reads all six). Append-only
`lead_score_events` with `computed_by ('manual'|'system'|'import')` + actor +
timestamp = audit trail; no client insert/update/delete policies = immutable
from the app. **Correction (fixed inline §7.3/§5.11):** the original trigger
was update-only and compared only 4 of the 6 stored fields — the lead's first
score was never snapshotted and edits to `follow_up_evidence`/
`recommended_action` left no trace. Now: fire on insert and update, compare all
six. `created_by` gained its FK (workspace_members, set null).

### 13.5 Frontend parity — enum values all match; four field-level gaps fixed

Verified against `types.ts`: lead statuses (6), pipeline stages (5 + lost,
matching `PipelineStage = Exclude<LeadStatus,"lost">`), sources (6),
business types (3), countries (3), priorities (3), task types (5 incl. admin),
activity types (5 incl. note), qualifications (4) — **all check constraints
match the frontend unions exactly**. Mock data was checked against proposed
uniques: 8 distinct company names, 10 distinct contact emails — seedable
without violations; leads intentionally repeat company names (no unique on
leads — deliberate).

Gaps fixed inline: **(a)** `related_to text` added to tasks and activities —
`Task.relatedTo`/`Activity.relatedTo` are mandatory free-text in
`types.ts:97/106`, searched by the screens, and carry entity-less values
("Internal", `mock-data.ts:246`); the FK-only design could not store them.
**(b)** Settings screen (`settings/page.tsx`) writes `workspace.region` (line
66), `defaultOwner` (78), `followUpDays` (80) and 4 notification booleans
(70–74) — none had a home in the schema; columns/JSONB added to §5.1/§5.2.
**(c)** `workspace_members.user_id` needed `on delete cascade` (see §13.9).
**(d)** Owner-string mapping, empty-string↔null date mapping, and the
closed-`LeadSource`-union limitation are documented in §10.

### 13.6 Helper hardening (low) — applied

`search_path` changed `public`→`''` (strictest; safe because every reference
is schema-qualified). `service_role` added to the execute grant. profiles'
co-member read policy must route through a definer helper — a direct
`workspace_members` subquery inside it recurses (now noted inline §5.2).

### 13.7 Uniqueness & data integrity — verified correct; minor notes

- Companies `unique (workspace_id, lower(name))` — workspace-scoped, correct;
  consider `lower(btrim(name))` at implementation time (whitespace
  normalization belongs at the API layer)
- Contacts partial unique `(workspace_id, lower(email)) where email <> ''` —
  predicate correctly excludes NULL, so nullable/blank emails coexist
- Leads: no unique constraint, deliberate (CRM duplicates are legal) — now
  stated as intentional
- `pipeline_stages` `unique (workspace_id, position)` means inserting a stage
  "in between" requires renumbering siblings — app-level concern, noted
- `source_id on delete set null` conflicts with the non-nullable frontend
  `Lead.source`: system sources need deletion protection (restrict or
  `is_system` guard) — flagged inline §5.6 and as open decision §13.13
- `lead.currency` vs `workspace.currency` precedence rule not yet defined —
  open decision §13.12

### 13.8 Deletion behavior — one open decision (history loss)

`tasks`/`activities` cascade from lead/company/contact: deleting a lead
silently destroys its task and activity history. No delete UI exists in B1, so
this is latent, but the FKs will be written that way. Open decision §13.14.

### 13.9 FK on-delete gaps — fixed

`workspace_members.user_id` without cascade made auth-user deletion abort
(profile cascade blocked by membership FK) — fixed to `on delete cascade`
(§5.3). `created_by` FKs (leads, self-FK on members) had no on-delete and
would block member deletion — set null (§5.3/§5.6/§5.11).

### 13.10 Migration safety — verified

`supabase/migrations/20261022102536_initial_schema.sql` re-verified **0 bytes,
untouched**; plan keeps it as-is and adds new timestamped migrations (§11).
`db push` to the linked project is explicitly approval-gated. Ordering
requirement added (§11.2): `lead_imports` before `leads`; parent
`unique (workspace_id, id)` before composite FKs. Nothing was applied.

### 13.11 Demo mode — verified viable; one requirement added

No file under `src/` reads any environment variable today (grep-verified), so
absent Supabase env vars keep the pure `useState` mock store working with zero
changes. Requirement added inline (§11.4): the auth middleware must no-op when
env vars are absent, otherwise it would redirect the env-less demo app to a
login page that cannot exist. The adapter switch is a single module-scope
both-env-vars check, not a per-call flag.

### 13.12 Prioritized unresolved decisions (need owner input before B2)

1. **P1 — Member offboarding semantics:** when a member row is deleted, what
   happens to their `owner_id`/`assignee_id` links (set null → "Unassigned",
   per plan) and their historical activities (`owner_id` set null loses
   attribution)? Alternative: soft-disable members (`disabled_at`) and never
   delete. Affects §5.3, §5.4–§5.10.
2. **P1 — History retention on parent deletion:** cascade (current plan) vs
   `set null` for tasks/activities when a lead/company is deleted. Recommend
   deciding before the FKs are written (§13.8).
3. **P2 — Notification prefs storage:** single `jsonb` on `profiles` (current
   inline default) vs 4 typed boolean columns. JSONB is schemaless against the
   Settings tab; typed columns get NOT NULL discipline.
4. **P2 — Lead currency precedence:** `lead.currency` overriding
   `workspace.currency` in Reports/_dashboard formatting, or drop per-lead
   currency in B1 (leads priced in workspace currency only).
5. **P2 — Source deletion policy:** restrict deleting `lead_sources` in use vs
   allow set-null + API fallback literal. Also whether custom sources are
   creatable in B1 (frontend union cannot display them without a type
   widening — §13.5d).
6. **P3 — Stage renumbering UX:** `unique (workspace_id, position)` makes
   mid-list stage insertion a multi-row update; accept, or relax to
   non-unique positions with app-side ordering.
7. **P3 — Whitespace-normalized uniqueness:** `lower(name)` vs
   `lower(btrim(name))` for companies/contacts/leads sources.
8. **P3 — Seed scope:** whether `b1_seed.sql` replays the mock dataset
   (`mock-data.ts`) into one demo workspace or stays empty.
