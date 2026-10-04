#!/usr/bin/env bash
#
# The one supported way to run the Playwright suite. Everything is local and isolated:
#
#   - database  : the guarded test Postgres (scripts/lib/testDatabase.ts), never .env.local
#   - storage   : a local Supabase-Storage-compatible server (tests/e2e/helpers/fake-storage-server.ts)
#   - email     : captured to a JSONL file (EMAIL_TRANSPORT=capture), never sent
#   - app       : a production build in .next-e2e, built with the isolated env above
#                 (Next inlines NEXT_PUBLIC_* at build time, so the build itself must be isolated)
#
# Prerequisite: a seeded test DB - `npm run test:setup-db`.
#
# Usage:
#   npm run test:e2e                         # every project
#   npm run test:e2e -- --project=editor-workflow
#   RUN_VITEST=1 npm run test:e2e           # run live-server Vitest checks as well
#
# Playwright's own config refuses to start unless this script has set E2E_ISOLATED=1.
set -uo pipefail
cd "$(dirname "$0")/.."

export E2E_APP_PORT="${E2E_APP_PORT:-3200}"
export FAKE_STORAGE_PORT="${FAKE_STORAGE_PORT:-54321}"
export EMAIL_CAPTURE_FILE="${EMAIL_CAPTURE_FILE:-/tmp/consilium-e2e-outbox.jsonl}"
# Each invocation owns its build; another audit cannot replace its manifests.
export E2E_DIST_DIR=".next-e2e-${E2E_APP_PORT}-$$"
export E2E_RUN_ID="${E2E_DIST_DIR#.}"
export E2E_RESULTS_DIR="test-results/$E2E_RUN_ID"

# eval of an empty command succeeds, even when $(...) failed. Check the generator
# separately, before cleanup, SQL, builds or service startup can happen.
E2E_EXPORTS="$(npx ts-node -P tsconfig.seed.json scripts/e2e-env.ts)" || { echo "✗ refusing: environment is not isolated" >&2; exit 1; }
eval "$E2E_EXPORTS" || exit 1
if [ -n "${AUDIT_BASE_URL:-}" ]; then
  echo "✗ refusing an existing server: its database, storage and email cannot be attested" >&2
  exit 1
fi
echo "→ test database : $(node -e 'console.log(new URL(process.env.TEST_DATABASE_URL).host)')"
echo "→ storage       : $NEXT_PUBLIC_SUPABASE_URL (local fake)"
echo "→ email         : captured to $EMAIL_CAPTURE_FILE (nothing is sent)"
echo "→ run evidence  : $E2E_RESULTS_DIR"
mkdir -p "$E2E_RESULTS_DIR"

PORT="$E2E_APP_PORT"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && wait "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT
# Never kill or reuse an unknown listener (including another audit).
for SERVICE_PORT in "$PORT" "$FAKE_STORAGE_PORT"; do
  if lsof -nP -iTCP:"$SERVICE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ port $SERVICE_PORT already occupied; select unused test ports" >&2
    exit 1
  fi
done

# Acquire a per-database lease before any schema/fixture writes.
node node_modules/ts-node/dist/bin.js -P tsconfig.seed.json scripts/acquire-test-workspace.ts "$E2E_RESULTS_DIR/database-lease.ready" &
LEASE_PID=$!
PIDS+=("$LEASE_PID")
for i in $(seq 1 40); do
  [ -f "$E2E_RESULTS_DIR/database-lease.ready" ] && break
  kill -0 "$LEASE_PID" 2>/dev/null || exit 1
  sleep 0.25
  [ "$i" = 40 ] && { echo "✗ database lease unavailable" >&2; exit 1; }
done

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"; [ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/helpers/local-storage-schema.sql || exit 1
# This guarded throwaway database is provisioned here; production is checked read-only.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20261001_team_member_user_link.sql || exit 1
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20261003231314_public_appointments_testing_sessions.sql || exit 1
npx ts-node -P tsconfig.seed.json scripts/check-deployment.ts || exit 1

: > "$EMAIL_CAPTURE_FILE"
npx ts-node -P tsconfig.seed.json scripts/clean-e2e-fixtures.ts || exit 1
npx ts-node -P tsconfig.seed.json scripts/reset-testing-photos.ts || exit 1

node node_modules/ts-node/dist/bin.js -P tsconfig.seed.json tests/e2e/helpers/fake-storage-server.ts & PIDS+=($!)

# A storage URL alone cannot attest all credentials/source in a cached build.
cp tsconfig.json "${NEXT_DIST_DIR}.tsconfig.json"
if [ "${TEST_WORKSPACE_DEV:-0}" = "1" ]; then
  echo "→ development server (isolated env) in ${NEXT_DIST_DIR}..."
  node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 -p "$PORT" >"$E2E_RESULTS_DIR/server.log" 2>&1 &
else
  echo "→ building (isolated env) into ${NEXT_DIST_DIR}..."
  npm run build >"$E2E_RESULTS_DIR/build.log" 2>&1 || { tail -40 "$E2E_RESULTS_DIR/build.log"; exit 1; }
  node node_modules/next/dist/bin/next start -p "$PORT" >"$E2E_RESULTS_DIR/server.log" 2>&1 &
fi
SERVER_PID=$!
PIDS+=("$SERVER_PID")
for i in $(seq 1 60); do
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -20 "$E2E_RESULTS_DIR/server.log"; exit 1; }
  curl -sf "http://localhost:$PORT/editorial/login" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 60 ] && { tail -20 "$E2E_RESULTS_DIR/server.log"; exit 1; }
done

export E2E_BASE_URL="http://localhost:$PORT"

if [ "${INTERACTIVE_TEST_WORKSPACE:-0}" = "1" ]; then
  echo "→ isolated testing workspace ready: $E2E_BASE_URL/admin/testing"
  echo "→ sign in as testing-admin@consilium.test / testing-local-1234 (local fixtures only)"
  echo "→ Ctrl+C stops the app and its local storage service"
  wait "${PIDS[${#PIDS[@]}-1]}"
  exit $?
fi

STATUS=0
if [ "${RUN_VITEST:-0}" = "1" ]; then
  mkdir -p test-results
  BASE_URL="$E2E_BASE_URL" AUDIT_NO_RATE_LIMIT=1 npx vitest run --reporter=default --reporter=json --outputFile="$E2E_RESULTS_DIR/vitest.json" || STATUS=1
fi

if [ "$#" -gt 0 ]; then
  # Explicit selection: pass it straight through, one invocation.
  npx playwright test "$@"
  BROWSER_STATUS=$?
  [ "$BROWSER_STATUS" = "0" ] || STATUS=1
  exit "$STATUS"
fi

# Full run, in three phases. The team-profile specs assert on the contents of the one
# shared storage server, so they must not overlap with anything else that uploads
# (the article-upload specs) and they run on a single worker.
E2E_PHASE=main npx playwright test || STATUS=1
E2E_PHASE=workflow npx playwright test --workers=1 || STATUS=1
E2E_PHASE=team-profile npx playwright test --workers=1 || STATUS=1
exit $STATUS
