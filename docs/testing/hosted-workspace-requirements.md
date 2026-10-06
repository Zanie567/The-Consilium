# Hosted testing workspace: requirements and reproducibility

Records what the hosted `consilium-testing` Supabase project must contain and how every part of it is recreated from committed code. It contains no credentials. The project is disposable review infrastructure: no production data was ever copied into it, and nothing in it is the only copy of anything.

| | |
|---|---|
| Supabase project | `consilium-testing`, ref `zrieajoqosgzyesfatta`, `eu-west-1`, Postgres 17, Free plan |
| Vercel project | `consilium-testing` (separate from `the-consilium`); origin `https://consilium-testing.vercel.app` |
| Source of the app | this repository; private mirror `Zanie567/The-Consilium-Testing` |
| Checked 4 October 2026 | live database compared with a database rebuilt from commit `6859d08` (below) |

## How each part is recreated

| Part | Committed source | Notes |
|---|---|---|
| 37 application tables, columns, indexes, constraints, enums | `prisma/schema.prisma` (`prisma db push`), then `supabase/migrations/*` | Verified identical, see below |
| `team_members.userId`, appointment fields, `testing_sessions` | `supabase/migrations/20261001_team_member_user_link.sql`, `20261003231314_public_appointments_testing_sessions.sql` | Idempotent; already part of `schema.prisma` |
| Database role, grants, policies, mail sink, personas, content, attestations | `scripts/prepare-hosted-testing-plan.ts` (connection-free; writes `fixtures-and-access.sql`) | Additive; refuses a populated unattested database |
| Storage buckets | `HOSTED_TEST_BUCKETS` / `hostedBucketSql()` in `src/lib/hostedTestingWorkspace.ts`, emitted by the same plan | Added after the audit: the buckets had been created by hand |
| Application configuration | `environment.private.json` from the same plan | 16 variables, listed below |

Recreate: create a project, put its `SUPABASE_SERVICE_ROLE_KEY` in the protected operator file, run `prepare-hosted-testing-plan.ts` (see `appointments-and-testing-mode.md`), apply the generated SQL once, load the generated variables into the separate Vercel project, then run `npm run check:deployment`. If the project is a *new* one, first update `HOSTED_TEST_WORKSPACE` (`projectRef`, `storageOrigin`, `workspaceId`; `poolerHost` if the region differs) and the Supabase CA used by `hostedDatabaseConnection`.

## Required contents

**Roles and access.** Role `consilium_testing`: login, not a superuser, does not bypass RLS. RLS is enabled on all 38 `public` tables with no access for `anon` or `authenticated`. Policies: `consilium_testing_server` (ALL, role `consilium_testing`) on every `public` table, and `consilium_testing_readiness` (SELECT, role `consilium_testing`) on `storage.buckets`. There are no `storage.objects` policies: uploads go through the server with the service key.

**Buckets** (both public):

| Bucket | Size limit | Allowed types |
|---|---|---|
| `article-images` | 10 MiB (10 485 760) | jpeg, png, gif, webp, avif |
| `avatars` | 5 MiB (5 242 880) | jpeg, png, gif, webp, avif |

**Extensions** (Supabase defaults, nothing custom): `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. No edge functions, no cron jobs.

**Seed content** (all from the plan): six verified personas at `consilium.test` (`admin`, `writer`, `writer-other`, `editor` with an Opinion assignment, `editor-global`, `growth`), categories Opinion and Economics, one editor assignment, one administrator-owned chief card, two review articles, and the attestation settings `testing-workspace` and `testing-hosted-project`. Fixture passwords are random on first provisioning, retained by the protected operator file on repeat setup, and are not in the repository.

**Mail.** `EMAIL_TRANSPORT=capture-db` stores generated mail in `testing_email_outbox`; no provider credentials exist.

## Application variables (names only)

`DATABASE_URL`, `DIRECT_URL` (role connection, strict TLS), `NEXTAUTH_SECRET`, `CRON_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL`, `SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TESTING_MODE_ENABLED=1`, `TESTING_WORKSPACE_KIND=hosted`, `TESTING_WORKSPACE_ID`, `EMAIL_TRANSPORT=capture-db`, `OUTBOUND_INTEGRATIONS_DISABLED=1`, `ADMIN_EMAILS`. The five secrets are regenerated, never recovered: Vercel will not reveal them and none is stored in the repository.

## Verification of 4 October 2026

A scratch database was built from commit `6859d08` by `prisma db push` plus the two SQL migrations, then both databases were fingerprinted with identical queries (per-table hash of columns with types, nullability and defaults; index definitions; constraint definitions; enum labels), excluding only `testing_email_outbox`, which the plan creates.

| Object | Count | Fingerprint (identical on both) |
|---|---:|---|
| columns | 37 tables | `c2e8d59b403c95f1d4f955e03c440a87` |
| constraints | 36 tables | `bc877c41280715d4020196ef8e172d81` |
| enums | 5 | `fc11c5385b93292af45891460b489972` |
| indexes | 37 tables | `767c8cbca8c84765b5a497b6bae479e5` |

Before the hosted browser journeys, the database held about 15 rows in total (6 users, 2 articles, 2 categories, 2 settings, 1 assignment, 1 team card, 1 login attempt), 12 MB, and no storage objects. This is a provisioning snapshot, not the current row count: actual browser workflows subsequently created test articles, media, a writer card, sessions, audit events, captured mail and notifications. The operator smoke retains its unique run-prefixed articles for review. Repeat setup preserved the six account/credential and administrator-card checksums.

## Pausing

Pausing keeps the data and project ref; the workspace is unavailable until restored, and restoring needs a free active-project slot on the plan. Hosted ordinary/simulated writer/editor/growth, publication, profile media and captured mail journeys passed on 4 October; see [acceptance and evidence](./acceptance-and-evidence.md). Repeat readiness and the representative smoke after recreation/restoration. Supplemental scheduling, save/upload rejection/recovery, shared-tab and session expiry/replay checks passed hosted on 5 October. Every toolbar control and the complete internal provider-failure matrix remain local coverage; see the acceptance report.


## Repeat hosted verification safely

Use the protected operator environment/credential files with `scripts/verify-hosted-testing.ts`; never export them into the destructive automated fixture harness. The default run covers ordinary/simulated publication journeys. `HOSTED_EXTENDED_CHECKS=1` adds resilience/session/scheduling checks; `HOSTED_EXTENDED_ONLY=1` runs only that supplemental selection. It requires the exact canonical isolated origin and its reviewed database/storage/mail attestations. `HOSTED_LEASE_PROBE=1` checks availability without interactive mutations.

The operator acquires `testing-hosted-browser-lease` in this test database before signing in or changing a profile. Concurrent operators sharing these personas are refused. Scoped cleanup releases only the exact invocation's lease; a terminated process's lease expires after 30 minutes. Unparseable/null state requires review rather than replacement. Test records have UUID run-prefixed titles. Clock advancement conditionally matches the exact test-owned scheduled article; the job refuses to run if another due article or eligible old trash could be affected. An unsuccessful clock probe restores only its own still-scheduled fixture to the future. Generated review articles and media remain for inspection; nothing in production is cleaned or reset.

Vercel can reject an upload request before the application handler, returning 413. The client displays actionable smaller-file feedback and retains the last saved content/card. Bucket limits do not override the hosting request-body gate.
