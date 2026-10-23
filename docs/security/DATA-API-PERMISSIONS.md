# Supabase Data API permissions audit (22 October 2026)

Evidence: read-only catalog queries on production (`scllbuwkcqtmfogsgalt`, PostgreSQL 17.6), repository code
search, and `scripts/db/data-api-harness.sh` on a disposable local Supabase stack (CLI 2.120.0, Postgres 17,
PostgREST, Storage, Auth). No production data was read; only catalog metadata and counts.

## How the site reaches the database

| Path | Role | Used for | Subject to grants/RLS? |
|---|---|---|---|
| Prisma (`DATABASE_URL`) | `postgres`: owner of every public object, BYPASSRLS, not superuser | every read and write | No (owner) |
| `@supabase/supabase-js` with the service key | `service_role` (BYPASSRLS) | **Storage only**: `/api/upload`, team photos, image cleanup | Storage schema only |
| Public pages and images | none | `/storage/v1/object/public/...` URLs of public buckets | No policy needed |
| Anyone with the anon key (in every page) | `anon`, or `authenticated` after a Supabase Auth sign-up | **nothing the site needs** | Yes: this is the surface audited here |

No repository code queries a table, view or RPC through the Data API, and no code uses Supabase Auth. External
integrations were not inventoried. Supabase Auth has 0 accounts; `pg_graphql` is not installed; the Realtime
publication contains no tables.

## Supabase's 30 October 2026 change

From 30 October, tables newly created in `public` on existing projects no longer receive automatic `SELECT/INSERT/
UPDATE/DELETE` for `anon`, `authenticated` **and `service_role`**. Existing tables keep their grants. Functions and
sequences are not covered. ([Supabase discussion #45329](https://github.com/orgs/supabase/discussions/45329))

**Effect on this project: none needed.** `20260408000100_restrict_column_grants.sql` already removed the automatic
`anon`/`authenticated` table grants for objects `postgres` creates. The extra `service_role` revoke does not matter:
Prisma connects as the owner, and the service role is used only for Storage. The harness proves this. It applies
Supabase's revoke, creates a table as Prisma would, and shows that the owner reads and writes normally while Storage
keeps working.

**Do not** add the "grant on all tables in schema public" catch-up from the announcement. It would expose every
server-only table to the anon key wherever RLS or a policy is missing.

## Inventory and classification (production, 43 tables, all owned by `postgres`, all with RLS)

| Data API access | Tables |
|---|---|
| **Public content, anon may read** (column allowlist + policy) | `articles` (19 public columns; published, not trashed, not hidden by a debate, after #155), `article_tags` (follows articles), `categories`, `series`, `tags` |
| **Granted columns, but no rows** | `team_members` (policy `false` after #155: the roster needs moderation data from `users`) |
| **Server-only** (no grant, RLS on, no policy: the 35 "RLS enabled, no policy" advisor notices, expected) | everything else: accounts, sessions, verification and reset tokens, users, subscribers, contact messages, comments and votes, debates, notes, corrections, analytics, audit logs, settings, testing and scheduler tables |

The anon read policies are not used by the site. They expose only content already on public pages. Closing the Data
API entirely is possible as further defence in depth (revoke the 41 anon column grants). That is an owner
decision, not done here.

**Storage:** `article-images` and `avatars` are public buckets. After #155 there is no client policy on
`storage.objects`: no client upload, update, delete or listing; public URLs keep serving. `avatars` has a 5 MB/MIME
limit. `article-images` has none at bucket level (`/api/upload` enforces both); adding one is a dashboard decision.

## Findings and what this PR changes

| # | Finding (production, 2026-10-22) | Risk | Change |
|---|---|---|---|
| 1 | Every function `postgres` creates in `public` is executable by `PUBLIC` (PostgreSQL default) and by `anon`/`authenticated` (Supabase defaults), so it is callable at `/rest/v1/rpc/<name>`. Supabase's change does not cover functions. Each `SECURITY DEFINER` function has needed a hand-written REVOKE; one omission would expose it. | High for future work | Migration `20261022120000`: revoke those defaults (global `PUBLIC` default for `postgres`; per-schema `anon`/`authenticated`) |
| 2 | `users_display_titles_valid`, `consilium_tag_identity` and `consilium_subscriber_identity` are callable by anon today | Low: pure, read nothing | Same migration revokes them from `PUBLIC`/`anon`/`authenticated`. `postgres` and `service_role` keep EXECUTE, so the `users` CHECK and the identity indexes still work (tested) |
| 3 | New sequences default to `anon`/`authenticated` USAGE/SELECT/UPDATE; `scheduler_invocations_id_seq` has them | Low: not reachable via PostgREST | Same migration revokes the default and the existing grant |
| 4 | `article-images` bucket exists only because of a dashboard action: a rebuild from the repository lacks it | DR gap | Migration `20261022120100` declares it (no-op on production) |
| 5 | `supabase_admin`'s default privileges in `public` grant everything to `anon`/`authenticated`; `postgres` cannot change them | Only if a platform tool creates objects in `public` | Not changeable from here. The regression test fails if any `public` object is not owned by `postgres` (production: 0) |
| 6 | Dashboard Storage policies, soft-deleted articles, team cards, unpinned search path | — | Fixed by #155 |

## Lasting regression tests

`tests/data-api/permissions-inventory.test.ts` runs in CI (job **Data API permissions**) after a **full rebuild**:
Supabase defaults, `prisma db push` as `postgres`, then every migration. It asserts:

- ownership of every object;
- RLS on every table;
- no table-level grant to an API role;
- the exact anon column allowlist;
- the exact API-role policies, word for word, and no client Storage policies;
- no function or sequence usable by API roles;
- pinned search paths;
- `postgres`'s default privileges.

Over HTTP it checks:
- a sweep of **every table** as anon and as a self-registered Supabase Auth user;
- `/rpc` for every function;
- that newly created tables, functions and sequences start private;
- the 30 October revoke;
- that Prisma's role, the service role's Storage access, the CHECK constraint, the identity indexes and public image URLs keep working.

When a new table must be readable through the Data API, the test makes you add it deliberately. Put the grant, RLS
and policy in the table's own migration, then extend the allowlists in the test.

## Production rollout (after #155's rollout) — owner approval required

Same procedure and session set-up as `docs/launch/POLICY-ROLLOUT.md`:

1. Fresh verified backup, or confirm the one taken for #155 the same day with no writes since that matter here.
2. `psql -X -v ON_ERROR_STOP=1 -f docs/security/production/preflight.sql`. Every row `ok = t`. On 2026-10-22 all rows
   matched except the prerequisite (#155's migration not yet applied), which is expected.
3. `psql -X -v ON_ERROR_STOP=1 -f docs/security/production/apply.sql` → `data api privileges verified …`, `COMMIT`.
4. `supabase migration repair --status applied 20261022120000 20261022120100 --linked`.
5. `psql -X -v ON_ERROR_STOP=1 -f docs/security/production/verify.sql`: all `ok`, registry 28 rows, fingerprint unchanged.
6. Through the site, check that topic creation, newsletter sign-up and an editor's display-title change all work.
   These paths use the three helper functions.

Rollback: reversal statements are at the end of the migration. Prefer granting one reviewed function explicitly
over restoring the defaults. A code rollback needs no database change.

Dashboard (owner): after 30 October, leave "Automatically expose new tables" **off**. Confirm the exposed schemas are
`public, graphql_public` only. Consider disabling Supabase Auth sign-ups.
