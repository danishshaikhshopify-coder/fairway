# Fairway CRM — Completion Checklist

Single source of truth for status, verification evidence, blockers, and risks.
Updated as work completes. `COMPLETE` = acceptance criteria met AND verified
by the evidence recorded here.

Legend: COMPLETE · IN PROGRESS · BLOCKED · NOT APPLICABLE

---

## 0. Verification baseline (B2 run 2026-10-27)

| Check | Command | Result |
|---|---|---|
| Unit tests (validation, CSV, duplicate detection, preferences, B2 mapping, **notification prefs**) | `npm test` | PASS — **67/67**, fail 0 (63 prior + 4 new prefs-mapping tests) |
| DOM tests (form, manage, CSV, settings prefs, login, **settings notifications**) | `npx vitest run <file>` (per file) | PASS — **31/31 across 6 files** (5 files prior + `settings-notifications-ui.test.tsx` 4/4) |
| Typecheck | `npm run typecheck` | PASS — 0 errors |
| Lint | `npm run lint` | PASS — clean (0 errors, 0 warnings) |
| Build | `npm run build` | PASS — 15 static routes + proxy |
| Database tests (Docker, `postgres:17`, auth shim) | `tests\db\run.ps1` | PASS — ALL TESTS PASSED: **4 migrations**, 15 assertion files, plus concurrency race |
| **B2 live check (real Supabase: GoTrue + PostgREST + RLS)** | `node tests\b2-live-check.mjs` | PASS — **21/21** against the local stack |
| **B2 auth live check (GoTrue flows + app proxy over HTTP)** | `node tests\b2-auth-live-check.mjs` | PASS — **20/20** (part B ran: dev server up, proxy redirects verified) |
| Browser E2E | desktop browser tool | BLOCKED — no browser connected to session; strongest practical coverage = `test:ui` + the live checks |

Environment caveats recorded honestly:

- **Memory pressure on this machine**: running all four `test:ui` files in a
  single vitest process, or two typecheck-heavy processes in parallel, caused
  Node OOM crashes (V8 "Zone Allocation"/"heap out of memory" at small sizes =
  OS-level allocation failures; ~1.6–2.6 GB free with Chrome + Docker VM
  holding memory). Worked around by running checks **sequentially** and the
  UI suite **per file** — every check passes that way.
- Docker Desktop engine 29.6.1 (restarted cleanly on 10-27; its daemon had
  stopped with the machine). Supabase CLI **works** (§4.3 resolved);
  local stack = postgres 17 + GoTrue + PostgREST + Kong, started with the
  heavy services excluded (`--exclude studio,storage-api,imgproxy,realtime,
  edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit`) to fit RAM.
- `.env.local` now exists and points at the **local** stack only. It is
  gitignored (verified: `git check-ignore` → `.gitignore:34:.env*`). No
  secrets committed; `@supabase/supabase-js` installed.
- Git: branch `main`, **zero commits, nothing staged** (staging requires
  explicit authorization).

---

## 1. Frontend — routes and features (F-area roadmap)

F1–F9 are not defined as repo artifacts; areas below map to the feature
roadmap in the project brief (Dashboard, Companies/Contacts, Leads, Pipeline,
Tasks/Activities, Reports, Lead Intelligence, Settings, Import/Export,
Cross-cutting UX/a11y).

| Area | Status | Evidence |
|---|---|---|
| F1 Dashboard | COMPLETE | CDP session: KPIs, attention links navigate; attention items now deep-link to `/leads?lead=<id>`; `test:ui` renders page; build ✓ |
| F2 Companies / Contacts | COMPLETE | Sort + pagination + edit (dialog) + delete (detail sheet, company delete cascades its contacts) + duplicate guards; DOM tests in `test:ui`; build ✓ |
| F3 Leads + add-lead form | COMPLETE | `npm test` 36/36 (validator + duplicate detection + CSV); `test:ui` 20/20 (form empty/invalid/clear/submit/prefill, edit/delete/duplicate, CSV import/export) |
| F4 Pipeline DnD + stage moves | COMPLETE (prior sessions) | CDP 50/50 round: DnD + keyboard "Move to" menu; overflow sweep ✓; stage "View details" now deep-links to `/leads?lead=<id>` |
| F5 Tasks / Activities | COMPLETE | CDP: task toggle, list rendering; delete with shared `ConfirmDialog`; "Related to" inputs get a `<datalist>` of existing companies/contacts/leads; build ✓ |
| F6 Reports / Lead Intelligence | COMPLETE (prior sessions) | CDP route sweep: h1 + zero runtime errors; build ✓ |
| F7 Settings / themes | COMPLETE | Theme matrix probe: Light/Dark/System + persistence ✓; **CRM preferences now persist** to `localStorage` (`src/lib/preferences.ts`) and prefill the add-lead form (owner + today+window follow-up date) — 3 DOM tests + 6 node tests |
| F8 Import / Export (CSV) | COMPLETE | Decision §1.1: lead CSV export + import implemented in demo mode (`src/lib/lead-csv.ts`, RFC-4180 parser, no new dependency); header/row/duplicate validation + results dialog; 9 node tests + 5 DOM tests |
| F9 Cross-cutting UX, a11y, responsive | COMPLETE (prior sessions) | Overflow sweep 375/390/430/768/1024/1440 × light/dark, 65/65 CDP checks |
| Mock vs real persistence | PARTIALLY WIRED (B2) | `crm-store.tsx` keeps one `useCrm` interface with two modes: **demo** (default, mock seed, nothing persists) and **live** (only when both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set) which hydrates from Supabase on mount and mirrors every mutation. CRM preferences persist in `localStorage`; notification preferences persist to `profiles` (live mode). Live mode is verified by `tests/b2-live-check.mjs` (21/21) + `tests/b2-auth-live-check.mjs` (20/20) but **not yet exercised in a browser** (§4.6) |

### 1.1 Import/Export decision (made this session)

CSV import/export does not exist anywhere in the frontend, and the README
roadmap does not require it. The B1 schema includes a `lead_imports` table,
so the feature is anticipated downstream. Decision: implement **lead CSV
export + import in demo (store) mode** with header/row/duplicate validation
and a results dialog — it materially improves daily CRM use and mirrors the
`lead_imports` contract. If audit evidence shows it should wait for B2, it is
moved to BLOCKED instead.
**Outcome: implemented** (row above, F8) — demo-mode CSV proved more valuable
than deferring; no dependency added.

---

## 2. Backend / database (B0–B1 complete; B2 in progress)

| Item | Status | Evidence |
|---|---|---|
| B1 schema migration | COMPLETE | `supabase/migrations/20261022120000_b1_schema.sql`; applies cleanly on fresh `postgres:17` in harness |
| B1 security remediation | COMPLETE | `20261022130000_b1_security_remediation.sql`: composite cross-workspace FKs (deferrable), last-owner guard + lifecycle, score attribution, import counters |
| B1 corrective migration (uniqueness trim) | COMPLETE | `20261024100000_b1_uniqueness_trim.sql`: unique guards → `lower(btrim(...))` for companies/lead_sources names + contacts email (index-only, additive); applies in harness; `95_uniqueness_trim.sql` PASS |
| **B2 migration (schema parity)** | COMPLETE | `20261026120000_b2_schema_parity.sql`: 4 typed notification-pref booleans on `profiles` (decision §5.3) + `related_to text` on `tasks`/`activities` (fixes a real B1 gap, see note below); applies in the harness **and** on a real local Supabase via `db reset` |
| DB test harness | COMPLETE | `tests\db\run.ps1` — ALL TESTS PASSED (RLS isolation, role escalation negatives, composite FKs, last-owner + concurrency race, attribution, counters, uniqueness trim); now applies all 4 migrations |
| Fresh-DB setup | VERIFIED | Harness = shim + all **four** migrations in order on stock PostgreSQL 17 |
| Upgrade scenario (applied DB) | **VERIFIED ON REAL SUPABASE** | `supabase db reset` on the local stack replays all 4 migrations cleanly (2026-10-26). Remediation remains strictly additive (see file header) |
| Shim vs real Supabase Auth | **RESOLVED FOR LOCAL** | Real GoTrue now exercised end-to-end by `tests\b2-live-check.mjs`: signup → `on_auth_user_created` bootstrap → workspace/member/stages/sources, self-service profile update, RLS isolation between two real users, anon denial. Remaining gap: hosted (cloud) GoTrue/JWT behaviour, which needs a real project |
| §13.12 owner decisions (8 items) | **8 OF 8 SETTLED** | Resolutions + evidence in §5 |
| B2: Supabase wiring (auth, client, store adapter) | IN PROGRESS | Local stack runs (§4.3 resolved). `@supabase/supabase-js` installed. Client + env switch (`src/lib/supabase/client.ts`, live only when both NEXT_PUBLIC vars set), row↔type mapping (`mapping.ts`, 24 node tests), repository (`repository.ts`), store adapter (`crm-store.tsx` mirrors writes, same `useCrm` interface). Verified against real local Supabase: `tests/b2-live-check.mjs` 21/21, `tests/b2-auth-live-check.mjs` 20/20 (incl. proxy over HTTP) |
| B2: auth UI + session wiring | COMPLETE | `/login` page (sign-in/up, validation, error mapping, safe `?next=`), `AuthProvider` (session + refresh + client-side guard), `src/proxy.ts` (Next 16 name), sign-out in AppShell, `Providers` re-keys the CRM store per user. 7 login DOM tests + 7 auth-rules node tests; live-verified 20/20 |
| B2: notification prefs persistence (decision §5.3) | COMPLETE | Settings → Notifications now hydrates from and saves to the 4 `profiles` columns in live mode (`loadNotificationPrefs`/`saveNotificationPrefs` in `repository.ts`, `rowToNotificationPrefs`/`notificationPrefsToRow` in `mapping.ts`); demo mode keeps the honest demo-only toast. 4 mapping node tests (incl. defaults-drift pin) + 4 DOM tests; live-verified by `b2-live-check.mjs` (defaults + self-update) |
| Remote/production DB changes | NOT APPLICABLE | None made; none without explicit authorization |

---

## 3. Security review status

| Area | Status | Evidence |
|---|---|---|
| Workspace/tenant isolation (RLS) | VERIFIED | `30_rls_isolation.sql` PASS |
| Role escalation (viewer/admin→owner) | VERIFIED | `41/42/43` PASS (negative tests) |
| Client-writable score history | VERIFIED | `44/45` PASS (negative tests) |
| Cross-workspace FKs | VERIFIED | `60` PASS; composite deferrable FKs in remediation |
| Last-owner / deletion lifecycle | VERIFIED | `70` + `71` concurrency race PASS |
| Attribution after member deletion | VERIFIED | `80` PASS (actor ≠ owner; NULL = system) |
| Import counters integrity | VERIFIED | `90` PASS |
| Signup bootstrap / hostile metadata | VERIFIED | `20` PASS |
| Duplicate guards match app behaviour (trim+case) | VERIFIED | `95` PASS — `lower(btrim(...))` rejects whitespace/case variants the frontend already treats as duplicates |
| Secrets in repo | VERIFIED | `.env*` gitignored except `.env.example` (names only); `.env.local` (local stack only) confirmed ignored by `git check-ignore`; no secrets printed in logs |
| **RLS + auth verified against REAL Supabase** | VERIFIED | `tests\b2-live-check.mjs` 21/21 on local GoTrue/PostgREST: two real signups cannot see each other's rows; anon gets no data on any table (schema revokes all anon grants); client cannot forge `lead_score_events`; score updates write append-only history via trigger |
| **PostgREST embed ambiguity (new finding)** | FIXED | The B1 remediation's composite `(workspace_id, owner_id)` FKs made every `workspace_members` embed ambiguous ("more than one relationship was found"). All repository selects now name their FK (`workspace_members!leads_owner_id_fkey`, etc.); verified live |
| **B1 gap: `related_to` missing** | FIXED | Plan §5.9/§5.10 declared `related_to text` on tasks/activities REQUIRED for frontend parity, but `b1_schema.sql` never created it — the UI's free-text "Related to" had nowhere to persist. Added in `20261026120000_b2_schema_parity.sql`; covered by the live check |

---

## 4. Known risks / blocked items

1. **Browser E2E unavailable** — desktop browser not connected to this
   session; DOM tests (`test:ui`) + prior CDP runs are the strongest
   practical coverage here.
2. **Live Supabase Auth — RESOLVED for local; hosted auth still untested.**
   Real GoTrue now runs locally and is covered end-to-end by
   `tests\b2-live-check.mjs` (signup → bootstrap trigger → RLS isolation →
   anon denial, 21/21). What remains untested is *cloud* GoTrue (managed
   JWTs, email confirmation, the pooler), which needs a real project.
3. **Supabase CLI — RESOLVED (2026-10-26): no longer blocked, no policy was
   bypassed.** The 10-24 entry was wrong about the cause. Evidence gathered
   this session:
   - Windows Application Control ("AppLocker") has **no rules at all**
     (`Get-AppLockerPolicy -Effective` → empty collections). It was never the
     blocker.
   - The enforcing policy is the OS built-in **VerifiedAndReputableDesktop**
     WDAC policy (`{0283ac0f-...}`, confirmed by CodeIntegrity event 3077 on
     10-24 naming that Policy ID). It blocked the CLI binary while it was
     *newly written and had no Microsoft reputation*.
   - The **same unchanged binary** (SHA-256
     `F51F2873...DB4995E`, mtime 10-24 05:31) now runs cleanly, repeatedly
     (`supabase --version` → `2.122.0`, exit 0), and **no new CodeIntegrity
     block events** have been logged since. The file acquired MVIS reputation
     after it had been on disk for two days. The block was reputation-lag, not
     a permanent policy denial.
   - Local stack verified working: `supabase start` brings up postgres 17 +
     GoTrue + PostgREST + Kong; `supabase db reset` replays all 4 migrations.
   Safest authorized path, now taken: **just wait and use the official binary
   unchanged.** No allow-listing, no signing, no policy edit, no admin rights
   were needed or used. If the block ever recurs (e.g. after a CLI upgrade to
   a fresh binary), the same waiting game applies; owner-side allow-listing
   remains the fallback and was NOT performed.
4. **No commits yet** — everything untracked; requires explicit authorization
   to stage/commit.
5. **Machine memory pressure** — parallel Node typecheck/build runs and the
   all-in-one `test:ui` process OOM'd (≈1.6–2.6 GB free with Chrome + Docker
   VM resident). Not a code defect: every check passes when run sequentially
   / per test file (§0). If `npm run test:ui` is re-run as one process, close
   background apps first or accept per-file runs. The Supabase stack is
   started with the heavy services excluded to stay inside this budget.
6. **B2 remaining work (not blocked):**
   - **Live-mode E2E in a browser** — no browser tool in this session, so
     live mode is proven by `tests\b2-live-check.mjs` + 
     `tests\b2-auth-live-check.mjs` (real GoTrue/PostgREST + the app proxy)
     but never clicked through end-to-end.
   - **Settings Profile/Workspace tabs** stay demo-only (their Save buttons
     say so honestly); persisting them needs owner input on which fields
     matter (email lives in auth.users by design; workspace region has no
     column yet — plan §5.1 drift).
   - **Owner/source display in live mode**: a fresh workspace has exactly one
     member (the signed-up owner), so owner dropdowns legitimately offer
     fewer options than the mock `OWNERS` list; unresolvable owner names
     persist as NULL → "Unassigned" (by design, plan §10).
7. **Local stack left running** — `supabase start` containers (db, auth,
   rest, kong) are up. `npx supabase stop` to reclaim RAM; `supabase status`
   prints the env values for `.env.local`.

---

## 5. Decisions log (§13.12 resolutions)

Resolutions recorded with their evidence; genuinely open items are marked
OPEN, not guessed.

| # | Item | Resolution |
|---|---|---|
| 1 | P1 Member offboarding | **As-built ratified**: ownership columns `on delete set null` → "Unassigned", historical attribution preserved via `lead_score_events.created_by` (tests `60`/`80` PASS). Soft-disable (`disabled_at`) deferred until a customer need appears |
| 2 | P1 History retention on parent delete | **CASCADE ratified** as written: tasks/activities/score-events cascade from lead/company; contacts cascade from company (`b1_schema.sql` §contacts/§tasks/§activities); demo store mirrors it (company delete removes its contacts) |
| 3 | P2 Notification prefs storage | **RESOLVED (B2, 2026-10-26): 4 typed boolean columns on `profiles`** — `new_lead_alerts`, `daily_digest`, `overdue_reminders`, `weekly_report`, all `boolean not null` with defaults matching the current UI (`true,true,true,false`). Rationale: the Settings tab is a *closed* set of four switches with fixed semantics, not a growing key/value map; typed columns give NOT NULL discipline, stay consistent with the rest of the schema (every column typed + constrained), and are inspectable with plain SQL. jsonb would re-implement validation in app code for no consumer that needs flexible keys. Migration `20261026120000_b2_schema_parity.sql`; **UI wired 2026-10-27** (load/save in `repository.ts`, Settings tab hydrates + persists in live mode) |
| 4 | P2 Lead currency precedence | **`lead.currency` overrides `workspace.currency`** for reports/dashboard formatting |
| 5 | P2 Source deletion policy | **`set null` ratified** (`leads.source_id on delete set null`, schema line 149). Custom source creation deferred to B2 — needs a frontend type-union widening |
| 6 | P3 Stage renumbering UX | **`unique (workspace_id, position)` kept**; accept multi-row update on mid-list insert |
| 7 | P3 Whitespace-normalised uniqueness | **`lower(btrim(...))` adopted** — new additive migration `20261024100000_b1_uniqueness_trim.sql` + `tests/db/95_uniqueness_trim.sql` (PASS); matches the frontend's existing `trim().toLowerCase()` comparisons |
| 8 | P3 Seed scope | **RESOLVED (B2, 2026-10-26): no demo seed; seed.sql stays empty.** Rationale: every workspace is created by the `on_auth_user_created` trigger with its pipeline stages and lead sources already populated, so seeding a demo workspace would fabricate a tenant with no `auth.users` row — unreachable behind RLS and unrepresentative of the real bootstrap path. Local verification exercises the *production* path (real signup → trigger → member-owned workspace) instead of a seed replay. The frontend mock dataset stays frontend-only demo data |

Session-level product decisions:

- **CSV import/export** implemented in demo mode (§1.1/F8), no new dependency.
- **Duplicate rules (app level)**: companies block duplicate name; contacts
  block duplicate email; leads block only when email **and** company match
  (same email under another company = a legitimate second deal).
- **CRM preferences** persist in `localStorage` (owner + follow-up window are
  consumed by the add-lead form; the currency pref is stored but display
  formatting stays USD until B2 — all mock values are USD-denominated, so
  relabelling them without conversion would misreport amounts).
- **Delete semantics (demo store) mirror the DB where rows are linked**: a
  company delete also removes its linked contacts (page-level cascade, mirrors
  `contacts.company_id on delete cascade`); leads are never removed by a
  company delete (DB: `leads.company_id on delete set null`); tasks/activities
  are independent demo rows with their own confirm-delete (DB cascades them
  from their parent — demo rows link by display string only, recorded as a
  demo-only simplification).

---

## 6. Session work log

Session of 2026-10-24 (batches A–J, then final verification). Nothing staged
or committed; migrations are additive; no remote/DB/deploy action taken.

| Batch | What changed | Evidence |
|---|---|---|
| A Quick wins | Companies empty state + Add action, duplicate-name guard (companies), duplicate-email guard (contacts), activities empty copy, company detail `mailto`, leads sort resets page, bulk-selection resets on filter change, dashboard badge shows full attention count, pipeline chip strip `role="group"`, settings labels `htmlFor`/`aria-labelledby` | typecheck + lint + build |
| B Lead duplicate detection | `findDuplicateLead` in `src/lib/lead-form.ts` (email **and** company, case/whitespace-insensitive) wired into lead submit (self excluded while editing) | `tests/lead-form-duplicate.test.ts` 6/6 |
| C Lead edit | `updateLead` wired; edit mode reuses the add dialog; Edit button in detail sheet; cancel clears edit mode | `test:ui` leads-manage 3 edit/dup tests |
| D Delete flows | `removeLead/Company/Contact/Task/Activity` in store; shared `ConfirmDialog`; confirm-delete on leads (row + sheet), companies (sheet + contact cascade), contacts, tasks, activities | `test:ui` leads-manage delete tests (2) |
| E Deep links | Dashboard attention items and pipeline "View details" → `/leads?lead=<id>`; leads page reads `?lead=` post-hydration (setTimeout, avoids lint/hydration issues) | build ✓, lint ✓ |
| F Companies/contacts edit + sort + pagination | `updateCompany`/`updateContact`; rename propagates to contacts/leads by name-join; sort (name/fit/city, name/company/title); page size 8 + pagination; empty-company guard | build ✓, typecheck ✓ |
| G Datalist | Tasks/activities "Related to" inputs get `<datalist>` of existing companies/contacts/leads (free text kept) | build ✓ |
| H Preferences persistence | `src/lib/preferences.ts` (load/save, validation, defaults); settings CRM tab loads saved prefs post-hydration and saves to `localStorage`; add-lead dialog prefills owner + `today+window` follow-up (`plusDaysIso`) | `tests/preferences.test.ts` 6/6; `settings-crm-prefs-ui.test.tsx` 3/3; leads-form prefill test (6/6 file) |
| I CSV import/export | `src/lib/lead-csv.ts` (RFC-4180 parser, no dependency); header buttons + results dialog; export/import/deep validation | `tests/lead-csv.test.ts` 9/9; `leads-csv-ui.test.tsx` 5/5 |
| J Uniqueness corrective migration | `supabase/migrations/20261024100000_b1_uniqueness_trim.sql` (index-only: `lower(name)` → `lower(btrim(...))`, email predicate `btrim(email) <> ''`); `tests/db/95_uniqueness_trim.sql`; harness copies/applies it; README table updated | `tests\db\run.ps1` → **ALL TESTS PASSED** (3 migrations, 15 assertion files, concurrency race) |

Final verification (sequential runs, 2026-10-24): `npm test` **36/36** ·
`npm run test:ui` per file **20/20 (4 files)** · `npm run typecheck` **0
errors** · `npm run lint` **clean** · `npm run build` **14/14 routes** ·
`tests\db\run.ps1` **ALL TESTS PASSED**. Browser E2E remains BLOCKED (§4.1);
Supabase CLI/local stack BLOCKED (§4.3); B2 BLOCKED pending owner input
(§2). Adapted existing empty-submit DOM test to the new prefilled follow-up
date (clears the field first — all five required-field assertions kept).

### Session of 2026-10-26 — B2: unblock, decisions, real persistence

Nothing staged or committed; no remote Supabase touched; no deploy; no
security control bypassed. Everything below ran against a **local** stack.

| Batch | What changed | Evidence |
|---|---|---|
| K CLI diagnosis | Proved the Application Control block was **not** AppLocker (no rules) but the OS **VerifiedAndReputableDesktop** WDAC policy blocking a then-reputation-less binary. The same unchanged binary now runs (reputation acquired); zero new CI block events. No bypass, no allow-listing, no admin action | §4.3; `supabase --version` exit 0 ×3; CodeIntegrity log scan |
| L Local stack | `supabase start` (heavy services excluded for RAM) → postgres 17 + GoTrue + PostgREST + Kong; `db reset` replays all 4 migrations | `supabase status`; container health checks |
| M Decisions §5.3/§5.8 | **Notification prefs → 4 typed booleans on `profiles`** (closed set of switches, NOT NULL discipline); **Seed scope → no demo seed** (trigger already provisions workspace+stages+sources; a seed would fabricate a tenant with no `auth.users`) | §5 rows 3 and 8 |
| N B2 migration | `20261026120000_b2_schema_parity.sql`: the 4 prefs columns **plus** the `related_to text` B1 gap on tasks/activities (plan required it, schema never had it) | applies in harness **and** on real Supabase; columns verified via `\d` |
| O Live check | `tests/b2-live-check.mjs` — real signup → bootstrap trigger → stages/sources/member, prefs default+update, lead insert/read, append-only score event, client-forge rejected, 2-user RLS isolation, anon denial | **21/21** |
| P Client + mapping | `@supabase/supabase-js` installed; `src/lib/supabase/client.ts` (live only when both NEXT_PUBLIC vars set); `mapping.ts` row↔type with join unwrapping + `patchRow` partial updates | `tests/b2-mapping.test.ts` **20/20** |
| Q Repository | `src/lib/supabase/repository.ts` — explicit selects with FK hints (fixes the embed ambiguity the probe caught), workspace context loader, inserts returning joined rows, partial updates that never clobber untouched columns | probe against live stack; typecheck ✓ |
| R Store adapter | `crm-store.tsx` keeps the exact `useCrm` interface; adds `loading`; demo mode is unchanged, live mode hydrates on mount and mirrors every mutation in the background | all 20 DOM tests pass unchanged; typecheck + lint + build ✓ |
| S Harness + env | Harness now applies all 4 migrations; `.env.local` created for the local stack (gitignored, verified) | `run.ps1` **ALL TESTS PASSED**; `git check-ignore .env.local` |

Final verification (sequential runs, 2026-10-26): `npm test` **56/56** ·
`npx vitest run <file>` per file **20/20 (4 files)** · `npm run typecheck`
**0 errors** · `npm run lint` **clean** · `npm run build` **14/14 routes** ·
`tests\db\run.ps1` **ALL TESTS PASSED (4 migrations)** ·
`node tests\b2-live-check.mjs` **21/21**. Browser E2E still BLOCKED (§4.1);
B2 is now IN PROGRESS, not blocked — remaining items are auth UI and
browser E2E (§4.6).

### Session of 2026-10-27 — B2: auth verification + notification prefs persistence

Nothing staged or committed; no remote Supabase touched; no deploy; no
security control bypassed (the WDAC diagnosis in §4.3 was re-verified, not
re-litigated: `supabase --version` → 2.122.0 exit 0, zero new CodeIntegrity
block events). The only environment action was starting the locally
installed Docker Desktop (its daemon had stopped), which is ordinary
software startup, not a policy change.

| Batch | What changed | Evidence |
|---|---|---|
| T Baseline re-verify | Discovered the auth UI from §4.6's "remaining" list already exists and passes (`/login`, `AuthProvider`, `src/proxy.ts`, sign-out); corrected the checklist | 7 login DOM + 7 auth-rules node tests; auth live check 20/20 incl. proxy-over-HTTP |
| U Prefs mapping | `NotificationPrefs` + `DEFAULT_NOTIFICATION_PREFS` in `types.ts`; `rowToNotificationPrefs`/`notificationPrefsToRow` in `mapping.ts` (fallback literals pinned to the defaults by test — mapping must stay loadable by `node --test`, which resolves neither `@/` nor extensionless imports) | `npm test` **67/67** (+4) |
| V Prefs repository | `loadNotificationPrefs`/`saveNotificationPrefs` in `repository.ts` — explicit `eq id = signed-in user`, `maybeSingle`, NOT NULL columns never fabricated | typecheck + lint |
| W Settings wiring | Notifications tab hydrates from `profiles` after the session exists (deferred tick, same hydration pattern as CRM prefs) and saves with success/error toasts; demo mode keeps the honest demo-only toast; live-but-loading save says "still signing you in" instead of claiming demo-only | `settings-notifications-ui.test.tsx` **4/4** |
| X Live re-verify | Local stack restarted with Docker; all four checks re-run sequentially | `b2-live-check` **21/21** · `b2-auth-live-check` **20/20** (part B: proxy redirects against `npm run dev`) · `run.ps1` **ALL TESTS PASSED** |

Final verification (sequential runs, 2026-10-27): `npm test` **67/67** ·
`npx vitest run <file>` per file **31/31 (6 files)** · `npm run typecheck`
**0 errors** · `npm run lint` **clean** · `npm run build` **15 routes +
proxy** · `tests\db\run.ps1` **ALL TESTS PASSED (4 migrations)** ·
`node tests\b2-live-check.mjs` **21/21** ·
`node tests\b2-auth-live-check.mjs` **20/20**. B2 remaining: live-mode
browser E2E (§4.6, no browser tool) and Settings Profile/Workspace
persistence (needs owner input on scope).
