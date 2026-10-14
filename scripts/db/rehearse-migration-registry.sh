#!/usr/bin/env bash
#
# Rehearses the migration-registry reconciliation (docs/remediation/migration-registry.md) on a DISPOSABLE local
# database. It never touches the repository's own supabase/migrations folder (it works on a scratch copy) and refuses
# any database that is not on localhost.
#
#   scripts/db/rehearse-migration-registry.sh postgresql://postgres:postgres@127.0.0.1:PORT/postgres
#
# It creates (and finally drops) a database named consilium_registry_rehearsal on that server, seeds its registry
# with production's four recorded rows (as of 2026-10-14), and then checks, against the folder as it is in the repo:
#   1. every local version is unique, no rollback is in migrations/, and production's four rows each match a file;
#   2. before the registry is reconciled, `supabase db push` refuses (nothing can be pushed by accident);
#   3. the versions to record are exactly the documented list: every file except production's four rows and the two
#      unapproved Supabase Cron files;
#   4. `migration repair --status applied` of that list inserts registry rows only: the database's objects are
#      unchanged, and the registry then holds 22 rows;
#   5. afterwards only the two cron files are pending, and `db push` still refuses to apply them unless someone
#      deliberately passes --include-all.
# Exits non-zero if any check fails. Needs the Supabase CLI and psql. Bash 3.2 compatible.
set -euo pipefail

SERVER_URL="${1:-}"
[ -n "$SERVER_URL" ] || { echo "usage: $0 postgresql://USER:PASS@127.0.0.1:PORT/postgres" >&2; exit 2; }
case "$SERVER_URL" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*|postgres://*@127.0.0.1:*|postgres://*@localhost:*) ;;
  *) echo "refusing: only a local disposable server is allowed (127.0.0.1 or localhost)" >&2; exit 2 ;;
esac
command -v supabase >/dev/null || { echo "the Supabase CLI is not installed" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DB=consilium_registry_rehearsal
BASE="${SERVER_URL%/*}"
URL="$BASE/$DB?sslmode=disable"
WORK="$(mktemp -d)"
trap 'psql "$SERVER_URL" -qc "drop database if exists $DB" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

REMOTE="20260610222208 20261003181523 20261006234853 20261006234931"
CRON="20261007120000 20261007120100"
# The exact list in docs/remediation/migration-registry.md, step 2.
TO_RECORD="20260408000000 20260408000100 20260511000000 20260612000000 20260903000000 20261001000000 20261003231314
20261005000000 20261006000000 20261006153514 20261006160355 20261006161413 20261006161505
20261010000000 20261010000100 20261011000000 20261012100000 20261012110000"

FAILED=0
check() { if [ "$2" = "$3" ]; then echo "   ok    $1"; else echo "   FAIL  $1: expected '$3', got '$2'"; FAILED=1; fi; }
sorted() { tr ' \n' '\n\n' | grep -v '^$' | sort | tr '\n' ' '; }

psql "$SERVER_URL" -qc "set client_min_messages = warning" -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql "$BASE/$DB" -q <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260610222208', 'add_comments_hiddenbody_and_debate_votes_anoniphash'),
  ('20261003181523', 'team_member_user_link'),
  ('20261006234853', 'public_appointments_testing_sessions'),
  ('20261006234931', 'member_onboarding');
create table public.sentinel (id int primary key);
SQL
mkdir -p "$WORK/p/supabase"
cp -R "$REPO/supabase/migrations" "$WORK/p/supabase/"
M="$WORK/p/supabase/migrations"
# Prints what the CLI said. Its exit status is not used: a refusal is an expected result here.
cli() { (cd "$WORK/p" && { supabase "$@" --db-url "$URL" 2>&1 || true; } | { grep -v '^Skipping migration' || true; }); }
# Every object in the database outside the registry, so a change of any kind shows up.
objects() { psql "$BASE/$DB" -Atc "select md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text, ',' order by n.nspname, c.relname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'supabase_migrations') and n.nspname not like 'pg_toast%'"; }
# local<TAB>remote per row of `migration list`.
list() { cli migration list | grep -oE '"local":"[0-9]*","remote":"[0-9]*"' | awk -F'"' '{ print $4 "\t" $8 }'; }

echo "1. The folder"
LOCAL=$(ls "$M" | grep -E '\.sql$' | cut -d_ -f1)
check "duplicate local versions" "$(echo "$LOCAL" | sort | uniq -d | tr '\n' ' ')" ""
check "rollback scripts in migrations/" "$(ls "$M" | grep -iE 'rollback|revert' | tr '\n' ' ')" ""
for v in $REMOTE; do check "production row $v has a local file" "$(echo "$LOCAL" | grep -c "^$v$")" "1"; done
check "files total (18 to record + 4 recorded + 2 cron)" "$(echo "$LOCAL" | wc -l | tr -d ' ')" "24"

echo "2. Before the registry is reconciled"
PUSH=$(cli db push --dry-run)
check "db push refuses" "$(echo "$PUSH" | grep -cE 'DbPushMissingRemoteError|Found local migration files to be inserted before the last migration')" "1"
check "db push would apply nothing" "$(echo "$PUSH" | grep -c 'Would push')" "0"

echo "3. The versions to record"
COMPUTED=$(echo "$LOCAL" | grep -vE "^($(echo $REMOTE $CRON | tr ' ' '|'))$" | sorted)
check "local versions minus production's 4 and the 2 cron files = documented list" "$COMPUTED" "$(echo "$TO_RECORD" | sorted)"

echo "4. Recording them (registry only)"
BEFORE=$(objects)
cli migration repair --status applied $TO_RECORD >/dev/null
check "database objects unchanged by repair" "$(objects)" "$BEFORE"
check "registry rows" "$(psql "$BASE/$DB" -Atc 'select count(*) from supabase_migrations.schema_migrations')" "22"
check "cron versions recorded" "$(psql "$BASE/$DB" -Atc "select count(*) from supabase_migrations.schema_migrations where version in ('20261007120000', '20261007120100')")" "0"

echo "5. Afterwards"
ROWS=$(list)
check "rows where local and remote differ (only the 2 cron files, local-only)" \
  "$(echo "$ROWS" | awk -F'\t' '$1 != $2 { print $1 "/" $2 }' | sorted)" "20261007120000/ 20261007120100/ "
check "remote-only rows" "$(echo "$ROWS" | awk -F'\t' '$1 == "" { print $2 }' | sorted)" ""
PUSH=$(cli db push --dry-run)
check "db push still refuses the older cron files" "$(echo "$PUSH" | grep -cE 'DbPushMissingRemoteError|Found local migration files to be inserted before the last migration')" "1"
ALL=$(cli db push --dry-run --include-all)
check "only --include-all would pick up the cron files, and nothing else" \
  "$(echo "$ALL" | grep -oE '20[0-9]{12}_[a-z0-9_]+\.sql' | sort -u | tr '\n' ' ')" \
  "20261007120000_scheduler_cron_infrastructure.sql 20261007120100_scheduler_cron_enable_publish.sql "

[ "$FAILED" = 0 ] && echo "RESULT: REHEARSAL PASSED" || { echo "RESULT: REHEARSAL FAILED"; exit 1; }
