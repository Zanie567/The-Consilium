#!/usr/bin/env bash
#
# Pre-launch audit suite. Builds the app, boots a production server with the
# rate limiter disabled (so functional HTTP assertions are deterministic), then
# runs the whole automated suite against it:
#
#   • vitest   — unit + in-process route-handler tests + live-server API audit
#                (asserts every route is 2xx/correct-shape; comments = 200 not 503)
#   • playwright— public + editorial E2E + link-crawler (no 4xx/5xx, no broken
#                images, zero console exceptions / no InvalidStateError)
#
# Usage:
#   npm run test:audit                 # full run (db setup + build + serve + test)
#   SKIP_DB_SETUP=1 npm run test:audit # reuse the already-seeded test DB
#   SKIP_BUILD=1 npm run test:audit    # reuse an existing .next build
#   AUDIT_BASE_URL=http://localhost:3000 npm run test:audit   # reuse a running server
#
set -uo pipefail
cd "$(dirname "$0")/.." || { echo "✗ could not cd to project root"; exit 1; }

# SAFETY: the server this script starts, and every seed it runs, must use the
# verified test database (TEST_DATABASE_URL or the local default) — never the
# production one in .env.local. Exporting these here means `next start` below
# inherits them (Next never overrides an already-set variable with .env.local).
# Aborts on an unsafe URL; the rules live in scripts/lib/assertSafeTestDatabaseHost.ts.
PORT="${AUDIT_PORT:-3100}"
# Database AND storage/email/OAuth: the server built and started here reads .env.local
# (production keys) for anything not set, so scripts/e2e-env.ts pins every service to a
# local stand-in, exactly as scripts/run-e2e.sh does.
export E2E_APP_PORT="$PORT" FAKE_STORAGE_PORT="${FAKE_STORAGE_PORT:-54321}" EMAIL_CAPTURE_FILE="${EMAIL_CAPTURE_FILE:-/tmp/consilium-audit-outbox.jsonl}"
eval "$(npx ts-node -P tsconfig.seed.json scripts/e2e-env.ts)" || { echo "✗ refusing: environment is not isolated"; exit 1; }
: > "$EMAIL_CAPTURE_FILE"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"; [ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/e2e/helpers/local-storage-schema.sql >/dev/null 2>&1 || true
npx ts-node -P tsconfig.seed.json tests/e2e/helpers/fake-storage-server.ts >/tmp/audit-storage.log 2>&1 &
STORAGE_PID=$!

BASE="${AUDIT_BASE_URL:-http://localhost:$PORT}"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "${STORAGE_PID:-}" ] && kill "$STORAGE_PID" 2>/dev/null
  # Backstop: free the port if next-server outlived its npm parent.
  if [ -z "${AUDIT_BASE_URL:-}" ]; then
    lsof -ti tcp:"$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  The Consilium — pre-launch audit suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Test database (idempotent: starts pg, syncs schema, seeds, de-dupes).
if [ "${SKIP_DB_SETUP:-0}" != "1" ]; then
  echo "→ [1/4] Preparing test database…"
  npm run test:setup-db || { echo "✗ DB setup failed"; exit 1; }
fi

if [ -z "${AUDIT_BASE_URL:-}" ]; then
  # 2. Production build.
  # Next inlines NEXT_PUBLIC_* at build time, so a build is only reusable if it was made
  # with this same isolated storage URL (the marker records it).
  MARKER="${NEXT_DIST_DIR}/.isolated-build"
  if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -f "$MARKER" ] || [ "$(cat "$MARKER")" != "$NEXT_PUBLIC_SUPABASE_URL" ]; then
    echo "→ [2/4] Building production server (isolated env, ${NEXT_DIST_DIR})…"
    rm -rf "$NEXT_DIST_DIR"
    npm run build || { echo "✗ build failed"; exit 1; }
    echo "$NEXT_PUBLIC_SUPABASE_URL" > "$MARKER"
  fi

  # 3. Boot the server with the rate limiter disabled.
  echo "→ [3/4] Starting server on :$PORT (RATE_LIMIT_DISABLED=1)…"
  RATE_LIMIT_DISABLED=1 npm run start -- -p "$PORT" >/tmp/audit-server.log 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 60); do
    curl -sf "$BASE/api/articles" >/dev/null 2>&1 && break
    sleep 2
    [ "$i" = "60" ] && { echo "✗ server did not become ready"; tail -20 /tmp/audit-server.log; exit 1; }
  done
  echo "  server ready at $BASE"
else
  echo "→ [2-3/4] Reusing server at $BASE"
fi

echo "→ [4/4] Running tests…"
FAILED=0

echo
echo "─── vitest (unit + integration) ─────────────────────────────"
BASE_URL="$BASE" AUDIT_NO_RATE_LIMIT=1 npx vitest run || FAILED=1

echo
echo "─── playwright (E2E + link-crawler) ─────────────────────────"
export E2E_BASE_URL="$BASE"
E2E_PHASE=main npx playwright test || FAILED=1
E2E_PHASE=workflow npx playwright test || FAILED=1
E2E_PHASE=team-profile npx playwright test --workers=1 || FAILED=1

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAILED" = "0" ]; then
  echo "  ✅ AUDIT PASSED — all suites green"
else
  echo "  ❌ AUDIT FAILED — see output above"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit "$FAILED"
