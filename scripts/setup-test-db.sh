#!/usr/bin/env bash
#
# Idempotent local/CI test database setup. Starts a throwaway Postgres 16
# cluster (port 5433, unix socket in /tmp), syncs the schema, and seeds the
# data the automated suite expects:
#   main seed  -> categories, staff users, 4 regular articles
#   debates    -> 3 debates + 6 debate articles (idempotent upsert version)
#   dedupe     -> collapse any duplicate articles (no-op once clean)
#   fixtures   -> reader/growth accounts + comments + scheduled/archived rows
#
# Re-runnable. USE_EXISTING_DB=1 points this at a database you supply via
# TEST_DATABASE_URL instead of starting a local cluster (e.g. a CI service
# container) — that database is still required to pass the fail-closed host
# check below.
#
# Safety: TEST_DATABASE_URL is the single source of truth for which database
# tests use. This script NEVER trusts .env.local (production) or an inherited
# DATABASE_URL/DIRECT_URL for where to connect: it resolves TEST_DATABASE_URL
# itself (the local cluster it just started, or the caller-supplied value under
# USE_EXISTING_DB=1), overwrites DATABASE_URL/DIRECT_URL with it before any
# prisma/seed command runs, and refuses to proceed if the host isn't localhost/
# 127.0.0.1 or the exact host allow-listed via TEST_DB_ALLOW_HOST — see
# scripts/lib/assertSafeTestDatabaseHost.ts, the one policy for all of this.
set -euo pipefail

cd "$(dirname "$0")/.."

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

PGPORT="${PGPORT:-5433}"
PGDATA="${PGDATA:-/tmp/consilium_pgdata}"
PGSOCK="${PGSOCK:-/tmp}"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"

if [ "${USE_EXISTING_DB:-0}" != "1" ]; then
  if ! pg_isready -h "$PGSOCK" -p "$PGPORT" >/dev/null 2>&1; then
    if [ ! -d "$PGDATA/base" ]; then
      echo "→ initialising Postgres cluster at $PGDATA"
      initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
    fi
    echo "→ starting Postgres on port $PGPORT"
    pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGSOCK" -l /tmp/pg_server.log -w start
  fi
  createdb -h "$PGSOCK" -p "$PGPORT" -U postgres consilium 2>/dev/null || true

  # The local cluster we just started/verified — explicitly, so nothing
  # downstream can fall back to whatever .env.local happens to say.
  export TEST_DATABASE_URL="postgresql://postgres@localhost:${PGPORT}/consilium"
else
  : "${TEST_DATABASE_URL:?USE_EXISTING_DB=1 requires TEST_DATABASE_URL to be set}"
fi
# One database for everything below, whatever the environment carried in.
export DATABASE_URL="$TEST_DATABASE_URL"
export DIRECT_URL="$TEST_DATABASE_URL"

# Marks every seed/dedupe script's own in-process safety check as active —
# see scripts/lib/assertSafeTestDatabaseHost.ts — so the check holds even if
# one of them is ever invoked outside this script with a stale env.
export TEST_HARNESS=1

echo "→ verifying resolved database host is safe for the test harness"
npx ts-node -P tsconfig.seed.json scripts/assert-safe-test-db.ts

echo "→ prisma generate + db push"
npx prisma generate >/dev/null
npx prisma db push >/dev/null

echo "→ seeding"
npm run db:seed
npm run db:seed-debates
npx ts-node -P tsconfig.seed.json prisma/dedupe-articles.ts
npx ts-node -P tsconfig.seed.json prisma/seed-test-fixtures.ts
npx ts-node -P tsconfig.seed.json prisma/seed-read-through.ts

# Functional indexes/checks/RLS are not represented by Prisma db push.
# Only the already-guarded test DB is eligible for these additive migrations.
for migration in \
  supabase/migrations/20261006153514_discovery_topic_identity.sql \
  supabase/migrations/20261006160355_managed_article_images.sql \
  supabase/migrations/20261006161413_normalized_subscriber_email.sql \
  supabase/migrations/20261006161505_article_active_engagement.sql; do
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done

echo "✅ test database ready (port $PGPORT)"
