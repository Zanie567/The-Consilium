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
# Re-runnable. Honours an existing DATABASE_URL/DIRECT_URL if you want to point
# at your own Postgres instead (set USE_EXISTING_DB=1).
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

  # .env.local must already point at this DB (committed example values do).
  if [ ! -f .env.local ]; then
    echo "✗ .env.local not found — create it with DATABASE_URL/DIRECT_URL pointing at" >&2
    echo "  postgresql://postgres@localhost:$PGPORT/consilium" >&2
    exit 1
  fi
fi

echo "→ prisma generate + db push"
npx prisma generate >/dev/null
npx prisma db push >/dev/null

echo "→ seeding"
npm run db:seed
npm run db:seed-debates
npx ts-node -P tsconfig.seed.json prisma/dedupe-articles.ts
npx ts-node -P tsconfig.seed.json prisma/seed-test-fixtures.ts

echo "✅ test database ready (port $PGPORT)"
