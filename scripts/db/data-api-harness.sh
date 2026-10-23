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
#   5. Rebuilds again and rehearses the operator rollout exactly as documented in
#      docs/launch/POLICY-ROLLOUT.md: preflight.sql, apply.sql, registry repair, verify.sql.
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

# Production's state before the hardening migration, rebuilt from Supabase defaults.
prepare_production_state() {
  echo "→ resetting the local database to Supabase defaults"
  supabase db reset --workdir "$WORKDIR" --no-seed >/dev/null 2>&1
  # The CLI only creates its registry when a migrations folder exists; create the same table.
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);" >/dev/null
  echo "→ prisma db push (as postgres, like production)"
  TEST_HARNESS=1 DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" npx prisma db push >/dev/null 2>&1
  echo "→ applying and recording the migrations production has applied"
  for migration in supabase/migrations/*.sql; do
    name="$(basename "$migration" .sql)"
    version="${name%%_*}"
    [ "$version" \< "$FIRST_UNAPPLIED" ] || continue
    case "$SKIP_MIGRATIONS" in *" $name.sql "*) ;; *) psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null ;; esac
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$version', '${name#*_}')" >/dev/null
  done
  echo "→ recreating production's dashboard-created Storage policies"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/data-api/fixtures/production-dashboard-drift.sql >/dev/null
}

STATUS=0
prepare_production_state
echo "→ running tests/data-api"
DATA_API_HARNESS=1 DATA_API_DB_URL="$DB_URL" DATA_API_URL="$API_URL" \
  DATA_API_ANON_KEY="$ANON_KEY" DATA_API_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npx vitest run -c vitest.data-api.config.ts || STATUS=1

echo "→ rehearsing the documented production rollout"
prepare_production_state
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f tests/data-api/fixtures/rehearsal-content.sql >/dev/null
rehearse() {
  local out
  out="$(psql "$DB_URL" -X -A -F '|' -v ON_ERROR_STOP=1 -f docs/launch/production/preflight.sql)"
  if printf '%s\n' "$out" | grep -E '\|f$' >&2; then echo "✗ preflight has failing rows (above)" >&2; return 1; fi
  local before; before="$(printf '%s\n' "$out" | grep '^content fingerprint|' | cut -d'|' -f2)"
  out="$(PGOPTIONS='-c client_min_messages=notice' psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f docs/launch/production/apply.sql 2>&1)"
  printf '%s\n' "$out" | grep -q 'public-access hardening verified' || { printf '%s\n' "$out" >&2; echo "✗ apply.sql did not verify" >&2; return 1; }
  # Same command the operator runs from the repository root (there with --linked).
  supabase migration repair --status applied "$FIRST_UNAPPLIED" --db-url "$DB_URL" >/dev/null 2>&1 \
    || { echo "✗ registry repair failed" >&2; return 1; }
  out="$(psql "$DB_URL" -X -A -F '|' -v ON_ERROR_STOP=1 -f docs/launch/production/verify.sql)"
  if printf '%s\n' "$out" | grep -E '\|f$' >&2; then echo "✗ verify has failing rows (above)" >&2; return 1; fi
  local after; after="$(printf '%s\n' "$out" | grep '^content fingerprint|' | cut -d'|' -f2)"
  [ -n "$before" ] && [ "$before" = "$after" ] || { echo "✗ content fingerprint changed ($before → $after)" >&2; return 1; }
  # A second apply must be refused by its precondition (already recorded), changing nothing.
  if psql "$DB_URL" -X -v ON_ERROR_STOP=1 -q -f docs/launch/production/apply.sql >/dev/null 2>&1; then
    echo "✗ apply.sql ran twice" >&2; return 1
  fi
  echo "  ✓ preflight all ok, apply verified, registry recorded, verify all ok, content unchanged, re-apply refused"
}
rehearse || STATUS=1

if [ "${DATA_API_STOP:-0}" = 1 ]; then
  supabase stop --workdir "$WORKDIR" --no-backup >/dev/null || true
fi
exit "$STATUS"
