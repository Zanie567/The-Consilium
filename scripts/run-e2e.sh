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
#   SKIP_BUILD=1 npm run test:e2e            # reuse .next-e2e (only if built by this script)
#
# Playwright's own config refuses to start unless this script has set E2E_ISOLATED=1.
set -uo pipefail
cd "$(dirname "$0")/.."

export E2E_APP_PORT="${E2E_APP_PORT:-3200}"
export FAKE_STORAGE_PORT="${FAKE_STORAGE_PORT:-54321}"
export EMAIL_CAPTURE_FILE="${EMAIL_CAPTURE_FILE:-/tmp/consilium-e2e-outbox.jsonl}"

eval "$(npx ts-node -P tsconfig.seed.json scripts/e2e-env.ts)" || { echo "✗ refusing: environment is not isolated"; exit 1; }
echo "→ test database : $(node -e 'console.log(new URL(process.env.TEST_DATABASE_URL).host)')"
echo "→ storage       : $NEXT_PUBLIC_SUPABASE_URL (local fake)"
echo "→ email         : captured to $EMAIL_CAPTURE_FILE (nothing is sent)"

PORT="$E2E_APP_PORT"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true; lsof -ti tcp:"$FAKE_STORAGE_PORT" 2>/dev/null | xargs kill 2>/dev/null || true; }
trap cleanup EXIT
cleanup # a leftover server from a previous run would silently serve the wrong env

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"; [ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/helpers/local-storage-schema.sql || exit 1
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20261001_team_member_user_link.sql 2>&1 | grep -v NOTICE

: > "$EMAIL_CAPTURE_FILE"
npx ts-node -P tsconfig.seed.json scripts/clean-e2e-fixtures.ts || exit 1

npx ts-node -P tsconfig.seed.json tests/e2e/helpers/fake-storage-server.ts & PIDS+=($!)

MARKER=".next-e2e/.isolated-build"
if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -f "$MARKER" ] || [ "$(cat "$MARKER")" != "$NEXT_PUBLIC_SUPABASE_URL" ]; then
  echo "→ building (isolated env) into ${NEXT_DIST_DIR}..."
  rm -rf "$NEXT_DIST_DIR"
  npm run build >/tmp/consilium-e2e-build.log 2>&1 || { tail -40 /tmp/consilium-e2e-build.log; exit 1; }
  echo "$NEXT_PUBLIC_SUPABASE_URL" > "$MARKER"
fi

npm run start -- -p "$PORT" >/tmp/consilium-e2e-server.log 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/articles" >/dev/null 2>&1 && break; sleep 1; [ "$i" = 60 ] && { tail -20 /tmp/consilium-e2e-server.log; exit 1; }; done

export E2E_BASE_URL="http://localhost:$PORT"

if [ "$#" -gt 0 ]; then
  # Explicit selection: pass it straight through, one invocation.
  npx playwright test "$@"
  exit $?
fi

# Full run, in two phases. The team-profile specs assert on the contents of the one
# shared storage server, so they must not overlap with anything else that uploads
# (the article-upload specs) and they run on a single worker.
STATUS=0
E2E_PHASE=main npx playwright test || STATUS=1
E2E_PHASE=workflow npx playwright test || STATUS=1
E2E_PHASE=team-profile npx playwright test --workers=1 || STATUS=1
exit $STATUS
