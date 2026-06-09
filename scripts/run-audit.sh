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
cd "$(dirname "$0")/.."

PORT="${AUDIT_PORT:-3100}"
BASE="${AUDIT_BASE_URL:-http://localhost:$PORT}"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
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
  if [ "${SKIP_BUILD:-0}" != "1" ]; then
    echo "→ [2/4] Building production server…"
    npm run build || { echo "✗ build failed"; exit 1; }
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
E2E_BASE_URL="$BASE" npx playwright test || FAILED=1

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAILED" = "0" ]; then
  echo "  ✅ AUDIT PASSED — all suites green"
else
  echo "  ❌ AUDIT FAILED — see output above"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit "$FAILED"
