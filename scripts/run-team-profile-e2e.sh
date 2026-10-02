#!/usr/bin/env bash
#
# Team Profile end-to-end run, entirely local:
#   local Postgres (the guarded test DB)  +  local Supabase-Storage-compatible server
#   +  a production build of the app pointed at both  +  Playwright (Chromium).
#
# SAFETY: the database comes from scripts/lib/testDatabase.ts (TEST_DATABASE_URL or the
# local default, checked by scripts/lib/assertSafeTestDatabaseHost.ts; never .env.local),
# the storage URL is a loopback address, and nothing here reaches production.
# Prerequisite: a seeded test DB — `npm run test:setup-db`.
set -uo pipefail
cd "$(dirname "$0")/.."

eval "$(npx ts-node -P tsconfig.seed.json scripts/test-db-env.ts)" || { echo "✗ refusing: unsafe test database"; exit 1; }
echo "→ test database: $(node -e 'console.log(new URL(process.env.TEST_DATABASE_URL).host)')"

PORT="${E2E_APP_PORT:-3200}"
STORAGE_PORT="${FAKE_STORAGE_PORT:-54321}"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true; }
trap cleanup EXIT

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"; [ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
# Storage schema + the project's own migration (creates the avatars bucket).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/helpers/local-storage-schema.sql || exit 1
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20261001_team_member_user_link.sql 2>&1 | grep -v NOTICE

FAKE_STORAGE_PORT="$STORAGE_PORT" npx ts-node -P tsconfig.seed.json tests/e2e/helpers/fake-storage-server.ts & PIDS+=($!)

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$STORAGE_PORT"
export SUPABASE_SERVICE_ROLE_KEY="local-service-key"
export NEXT_IMAGE_ALLOW_LOCAL_STORAGE=1
export NEXTAUTH_SECRET="local_e2e_secret"
export NEXTAUTH_URL="http://localhost:$PORT"
export NEXT_PUBLIC_SITE_URL="http://localhost:$PORT"
export RATE_LIMIT_DISABLED=1
export E2E_TEAM_PROFILE=1

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "→ building…"; npm run build >/tmp/team-e2e-build.log 2>&1 || { tail -30 /tmp/team-e2e-build.log; exit 1; }
fi
npm run start -- -p "$PORT" >/tmp/team-e2e-server.log 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -sf "http://localhost:$PORT/team" >/dev/null 2>&1 && break; sleep 1; [ "$i" = 60 ] && { tail -20 /tmp/team-e2e-server.log; exit 1; }; done

# One worker: the specs share one storage server and assert on its contents.
E2E_BASE_URL="http://localhost:$PORT" npx playwright test --project=team-profile --workers=1 "$@"
