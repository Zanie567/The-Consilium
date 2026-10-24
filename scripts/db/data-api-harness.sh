#!/usr/bin/env bash
#
# Data API / Storage permission tests against a DISPOSABLE local Supabase stack.
#
# What it does:
#   1. Starts (or reuses) the local stack defined in tests/data-api/stack (Postgres 17,
#      PostgREST, Storage API, Auth) and refuses anything that is not on 127.0.0.1.
#   2. Resets that stack's database, so every run starts from Supabase's own defaults
#      (roles, default privileges, supautils policy grants, storage schema).
#   3. Rebuilds the schema the way production got it: `prisma db push` as postgres, then
#      every supabase/migrations file older than the launch hardening migration (recorded in
#      the registry, as on production), then the Storage policies that were created in the
#      dashboard (tests/data-api/fixtures).
#   4. Runs tests/data-api with vitest. Those tests apply the hardening migration
#      themselves, so they prove both "before" (the defect) and "after" (the fix).
#   5. Rebuilds from Supabase defaults with EVERY migration in the repository (what a new
#      environment or a disaster-recovery rebuild gets) and runs the permission inventory.
#   6. Rebuilds production's state again and rehearses each pending production rollout exactly
#      as documented (docs/launch/POLICY-ROLLOUT.md, docs/security/DATA-API-PERMISSIONS.md):
#      preflight.sql, apply.sql, registry repair, verify.sql, refused re-apply.
#
# Never points at a hosted project: there is no link step, and every URL is checked.
#
# Usage:  bash scripts/db/data-api-harness.sh                  (start/reuse stack, test, rehearse)
#         DATA_API_STOP=1 bash scripts/db/data-api-harness.sh  (also stop the stack afterwards)
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/../.."

WORKDIR=tests/data-api/stack
EXCLUDE=vector,logflare,imgproxy,supavisor,postgres-meta,mailpit,studio,edge-runtime,realtime
# The hardening migration and anything newer are applied by the tests/rehearsal, not here.
FIRST_UNAPPLIED=20261018002859
# Applied on production but irrelevant to permissions: it only schedules a pg_cron job and
# refuses to run without a Vault secret and a recorded successful invocation. It is still
# recorded in the registry below, as on production.
SKIP_MIGRATIONS=" 20261007120100_scheduler_cron_enable_publish.sql "
# Pending migrations that create tables, columns or types for Prisma models: `prisma db push`
# already creates those objects, which production does not have yet. Their documented rollback
# removes exactly them, so the production copy matches production. Drop an entry once its
# migration is applied on production (and raise FIRST_UNAPPLIED past it).
AHEAD_OF_PRODUCTION_ROLLBACKS="supabase/manual/20261023120000_newsletter_subscriptions_rollback.sql"

if ! supabase status --workdir "$WORKDIR" >/dev/null 2>&1; then
  echo "→ starting the disposable local Supabase stack"
  supabase start --workdir "$WORKDIR" -x "$EXCLUDE" >/dev/null
fi

status_json="$(supabase status --workdir "$WORKDIR" -o json 2>/dev/null)"
field() { node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j[process.argv[2]]||"")' "$status_json" "$1"; }
DB_URL="$(field DB_URL)"
API_URL="$(field API_URL)"
ANON_KEY="$(field ANON_KEY)"
SERVICE_ROLE_KEY="$(field SERVICE_ROLE_KEY)"

for url in "$DB_URL" "$API_URL"; do
  host="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$url")"
  if [ "$host" != "127.0.0.1" ] && [ "$host" != "localhost" ]; then
    echo "✗ refusing a non-loopback Supabase endpoint: $host" >&2
    exit 1
  fi
done

# $1 = production: production's state before the pending migrations (applied files recorded in
#                   the registry, plus the dashboard-created Storage policies);
#      rebuild:    every migration in the repository, as a new environment would get.
prepare() {
  echo "→ [$1] resetting the local database to Supabase defaults"
  supabase db reset --workdir "$WORKDIR" --no-seed >/dev/null 2>&1
  # The CLI only creates its registry when a migrations folder exists; create the same table.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);" >/dev/null
  echo "→ [$1] prisma db push (as postgres, like production)"
  TEST_HARNESS=1 DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" npx prisma db push >/dev/null 2>&1
  echo "→ [$1] applying and recording migrations"
  for migration in supabase/migrations/*.sql; do
    name="$(basename "$migration" .sql)"
    version="${name%%_*}"
    if [ "$1" = production ]; then [ "$version" \< "$FIRST_UNAPPLIED" ] || continue; fi
    case "$SKIP_MIGRATIONS" in *" $name.sql "*) ;; *) psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null ;; esac
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$version', '${name#*_}')" >/dev/null
  done
  if [ "$1" = production ]; then
    for rollback in $AHEAD_OF_PRODUCTION_ROLLBACKS; do
      echo "→ [$1] removing what prisma db push created ahead of production ($(basename "$rollback"))"
      psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$rollback" >/dev/null
    done
    echo "→ [$1] recreating production's dashboard-created Storage policies"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/data-api/fixtures/production-dashboard-drift.sql >/dev/null
  fi
}

run_tests() {
  echo "→ running $*"
  DATA_API_HARNESS=1 DATA_API_DB_URL="$DB_URL" DATA_API_URL="$API_URL" \
    DATA_API_ANON_KEY="$ANON_KEY" DATA_API_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    npx vitest run -c vitest.data-api.config.ts "$@"
}

# One documented rollout: $1 = directory with preflight/apply/verify.sql, $2 = version, $3 = notice
# printed by a verified apply. Every preflight/verify row must be ok; the content fingerprint must not move.
rehearse() {
  local dir="$1" version="$2" notice="$3" out before after
  out="$(psql "$DB_URL" -X -A -F '|' -v ON_ERROR_STOP=1 -f "$dir/preflight.sql")"
  if printf '%s\n' "$out" | grep -E '\|f$' >&2; then echo "✗ $dir/preflight.sql has failing rows (above)" >&2; return 1; fi
  before="$(printf '%s\n' "$out" | grep '^content fingerprint|' | cut -d'|' -f2)"
  out="$(PGOPTIONS='-c client_min_messages=notice' psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$dir/apply.sql" 2>&1)"
  grep -q "$notice" <<<"$out" || { printf '%s\n' "$out" >&2; echo "✗ $dir/apply.sql did not verify" >&2; return 1; }
  # Same command the operator runs from the repository root (there with --linked).
  supabase migration repair --status applied $version --db-url "$DB_URL" >/dev/null 2>&1 \
    || { echo "✗ registry repair failed for $version" >&2; return 1; }
  out="$(psql "$DB_URL" -X -A -F '|' -v ON_ERROR_STOP=1 -f "$dir/verify.sql")"
  if printf '%s\n' "$out" | grep -E '\|f$' >&2; then echo "✗ $dir/verify.sql has failing rows (above)" >&2; return 1; fi
  after="$(printf '%s\n' "$out" | grep '^content fingerprint|' | cut -d'|' -f2)"
  [ -n "$before" ] && [ "$before" = "$after" ] || { echo "✗ content fingerprint changed ($before → $after)" >&2; return 1; }
  if psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q -f "$dir/apply.sql" >/dev/null 2>&1; then
    echo "✗ $dir/apply.sql ran twice" >&2; return 1
  fi
  echo "  ✓ $version: preflight ok, apply verified, registry recorded, verify ok, content unchanged, re-apply refused"
}

# Rows of a newsletter preflight/verify (check|value|expect) whose expectation is a definite value
# (true, false or a number, optionally followed by a comment) and do not match. Rows marked
# "informational", and other free-text expectations, are read by the operator.
newsletter_mismatches() {
  awk -F'|' 'NF >= 3 && $3 !~ /informational/ && $3 ~ /^(true|false|[0-9]+)( |$)/ { split($3, e, " "); if ($2 != e[1]) print }'
}

# The newsletter rollout (docs/newsletter/ROLLOUT.md R1-R2) on the state the security rollouts left:
# preflight, verified apply, registry repair, verify, unchanged subscriber fingerprint, refused re-apply.
rehearse_newsletter() {
  local dir=docs/newsletter/production version=20261023120000 out before after bad
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO subscribers (id, email) VALUES
    ('rehearsal-subscriber-1', 'reader.one@example.com'), ('rehearsal-subscriber-2', 'reader.two@example.com')" >/dev/null
  out="$(psql "$DB_URL" -X -A -t -F '|' -v ON_ERROR_STOP=1 -f "$dir/preflight.sql")"
  bad="$(printf '%s\n' "$out" | newsletter_mismatches)"
  [ -z "$bad" ] || { printf '%s\n' "$bad" >&2; echo "✗ $dir/preflight.sql has failing rows (above)" >&2; return 1; }
  before="$(printf '%s\n' "$out" | grep '^subscribers fingerprint|' | cut -d'|' -f2)"
  out="$(PGOPTIONS='-c client_min_messages=notice' psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$dir/apply.sql" 2>&1)"
  grep -q 'newsletter migration verified (first): 2 subscriber(s) LEGACY' <<<"$out" \
    || { printf '%s\n' "$out" >&2; echo "✗ $dir/apply.sql did not verify" >&2; return 1; }
  supabase migration repair --status applied $version --db-url "$DB_URL" >/dev/null 2>&1 \
    || { echo "✗ registry repair failed for $version" >&2; return 1; }
  out="$(psql "$DB_URL" -X -A -t -F '|' -v ON_ERROR_STOP=1 -f "$dir/verify.sql")"
  bad="$(printf '%s\n' "$out" | newsletter_mismatches)"
  [ -z "$bad" ] || { printf '%s\n' "$bad" >&2; echo "✗ $dir/verify.sql has failing rows (above)" >&2; return 1; }
  after="$(printf '%s\n' "$out" | grep '^subscribers fingerprint|' | cut -d'|' -f2)"
  [ -n "$before" ] && [ "$before" = "$after" ] || { echo "✗ subscriber fingerprint changed ($before → $after)" >&2; return 1; }
  if psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q -f "$dir/apply.sql" >/dev/null 2>&1; then
    echo "✗ $dir/apply.sql ran twice" >&2; return 1
  fi
  echo "  ✓ $version: preflight ok, apply verified (2 LEGACY), registry recorded, verify ok, fingerprint unchanged, re-apply refused"
}

STATUS=0
prepare production
run_tests tests/data-api/public-access-hardening.test.ts || STATUS=1

prepare rebuild
run_tests tests/data-api/permissions-inventory.test.ts || STATUS=1

echo "→ rehearsing the documented production rollouts, in order"
prepare production
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/data-api/fixtures/rehearsal-content.sql >/dev/null
rehearse docs/launch/production 20261018002859 'public-access hardening verified' || STATUS=1
rehearse docs/security/production '20261022120000 20261022120100' 'data api privileges verified' || STATUS=1
# Production order: #155's and #156's preflights expect exactly 25 and 26 registry rows, so the
# newsletter migration goes last (its own preflight accepts any count).
rehearse_newsletter || STATUS=1

if [ "${DATA_API_STOP:-0}" = 1 ]; then
  supabase stop --workdir "$WORKDIR" --no-backup >/dev/null || true
fi
exit "$STATUS"
