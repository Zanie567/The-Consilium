#!/usr/bin/env bash
#
# Build and serve a production build for performance measurement, isolated from
# every production service. Unlike scripts/run-e2e.sh this does NOT enable testing
# mode (whose banner and per-request session lookup would distort page timings).
#
#   PERF_DATABASE_URL=postgresql://postgres@127.0.0.1:55631/consilium \
#   PERF_PORT=3310 PERF_DIST_DIR=.next-perf-after bash scripts/perf/serve-local.sh
#
# The database must be a local, seeded test database (scripts/setup-test-db.sh with
# USE_EXISTING_DB=1). The script refuses to run when any .env* file other than
# .env.example exists, because `next build`/`next start` would read production keys
# from it for every variable not set below.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PERF_DATABASE_URL:?set PERF_DATABASE_URL to a local seeded test database}"
PORT="${PERF_PORT:-3310}"
DIST="${PERF_DIST_DIR:-.next-perf}"

for f in .env .env.local .env.production .env.production.local; do
  if [ -e "$f" ]; then echo "✗ refusing: $f exists and could leak production keys into the build" >&2; exit 1; fi
done
host="$(node -e 'console.log(new URL(process.env.PERF_DATABASE_URL).hostname)')"
case "$host" in localhost|127.0.0.1) ;; *) echo "✗ refusing non-local database host: $host" >&2; exit 1 ;; esac

export DATABASE_URL="$PERF_DATABASE_URL" DIRECT_URL="$PERF_DATABASE_URL"
export NEXTAUTH_URL="http://localhost:$PORT" NEXT_PUBLIC_SITE_URL="http://localhost:$PORT"
export NEXTAUTH_SECRET="perf-local-$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
# Storage, email, OAuth and third-party data are pointed at nothing.
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:9" NEXT_PUBLIC_SUPABASE_ANON_KEY="perf-local" SUPABASE_SERVICE_ROLE_KEY="perf-local"
export EMAIL_TRANSPORT=capture EMAIL_CAPTURE_FILE="/tmp/consilium-perf-outbox.jsonl" OUTBOUND_INTEGRATIONS_DISABLED=1
export RESEND_API_KEY="" GOOGLE_CLIENT_ID="" GOOGLE_CLIENT_SECRET="" FRED_API_KEY="" ALPHA_VANTAGE_API_KEY=""
export NEXT_DIST_DIR="$DIST" NEXT_TELEMETRY_DISABLED=1

if [ "${PERF_SKIP_BUILD:-0}" != 1 ]; then
  node node_modules/next/dist/bin/next build
fi
exec node node_modules/next/dist/bin/next start -p "$PORT"
