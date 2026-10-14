#!/usr/bin/env bash
#
# Rehearses the migration-registry reconciliation (docs/remediation/migration-registry.md) on a DISPOSABLE local
# database. It never touches the repository's own supabase/migrations folder (it works on a scratch copy) and refuses
# any database that is not on localhost.
#
#   scripts/db/rehearse-migration-registry.sh postgresql://postgres:postgres@127.0.0.1:PORT/postgres
#
# It creates (and finally drops) a database named consilium_registry_rehearsal on that server, seeds its registry
# with production's four recorded rows (as of 2026-10-14), and then shows:
#   A. today: `supabase db push` refuses (remote versions are unknown locally);
#   B. the CLI's own suggestion (repair --status reverted, then push) would re-run all 19 files, including a rollback
#      that drops users."displayTitles" and the unapproved Supabase Cron migrations;
#   C. the proposed reconciliation (unique 14-digit versions, rollback moved out, record files for the four remote
#      versions, `migration repair --status applied` for the applied files only) leaves exactly the two cron files
#      pending, repair runs no SQL (the database gains no table), and `db push` refuses to apply the two older cron
#      files unless --include-all is passed deliberately.
# Needs the Supabase CLI. Bash 3.2 compatible.
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

seed() {
  psql "$SERVER_URL" -qc "set client_min_messages = warning" -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  psql "$BASE/$DB" -q <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260610222208', 'add_comments_hiddenbody_and_debate_votes_anoniphash'),
  ('20261003181523', 'team_member_user_link'),
  ('20261006234853', 'public_appointments_testing_sessions'),
  ('20261006234931', 'member_onboarding');
SQL
}
fresh_copy() { rm -rf "$WORK/p"; mkdir -p "$WORK/p/supabase"; cp -R "$REPO/supabase/migrations" "$WORK/p/supabase/"; }
# Prints what the CLI said. Its exit status is not used: a refusal (step A) is an expected result here.
cli() { (cd "$WORK/p" && { supabase "$@" --db-url "$URL" 2>&1 || true; } | { grep -v '^Skipping migration' || true; }); }

echo "A. Today"
seed; fresh_copy
cli db push --dry-run | grep -oE 'DbPushMissingLocalError|Would push' | head -1

echo "B. Following the CLI's own advice (repair --status reverted, then push)"
cli migration repair --status reverted 20260610222208 20261003181523 20261006234853 20261006234931 >/dev/null
cli db push --dry-run | grep -vE "^(DRY RUN|Connecting)" | cut -c1-300 | sed "s/^/   /"

echo "C. The proposed reconciliation"
seed; fresh_copy
M="$WORK/p/supabase/migrations"
mkdir -p "$WORK/p/supabase/manual"
mv "$M/20261005_user_display_titles_rollback.sql" "$WORK/p/supabase/manual/"
# Unique 14-digit versions that keep the original order (old -> new).
while read -r old new; do mv "$M/$old.sql" "$M/$new.sql"; done <<'MAP'
20260408_enable_rls 20260408000000_enable_rls
20260408_restrict_column_grants 20260408000100_restrict_column_grants
20260903_enable_rls_remaining_tables 20260903000000_enable_rls_remaining_tables
20261001_team_member_user_link 20261001000000_team_member_user_link
20261005_user_display_titles 20261005000000_user_display_titles
20261006_member_onboarding 20261006000000_member_onboarding
20261010_debate_lifecycle 20261010000000_debate_lifecycle
20261010_team_member_updated_at 20261010000100_team_member_updated_at
20261011_hidden_debate_article_guard 20261011000000_hidden_debate_article_guard
add_article_comments 20260511000000_add_article_comments
add_article_comments_quoted_text 20260612000000_add_article_comments_quoted_text
MAP
# The four versions production recorded when changes were applied through the API: kept as history, never re-run.
printf -- '-- Recorded in production on 2026-06-10 via the Supabase API (this exact SQL, from the registry).\nALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "hiddenBody" text;\nALTER TABLE "debate_votes" ADD COLUMN IF NOT EXISTS "anonIpHash" text;\nCREATE UNIQUE INDEX IF NOT EXISTS "debate_votes_debateId_anonIpHash_key" ON "debate_votes"("debateId", "anonIpHash");\n' \
  > "$M/20260610222208_add_comments_hiddenbody_and_debate_votes_anoniphash.sql"
for rec in "20261003181523 team_member_user_link 20261001000000_team_member_user_link" \
           "20261006234853 public_appointments_testing_sessions 20261003231314_public_appointments_testing_sessions" \
           "20261006234931 member_onboarding 20261006000000_member_onboarding"; do
  set -- $rec
  printf -- '-- Registry record only: production applied %s.sql under this version via the Supabase API.\n-- Intentionally empty, so the change is never applied twice.\n' "$3" > "$M/${1}_$2.sql"
done
dupes=$(ls "$M" | cut -d_ -f1 | sort | uniq -d)
[ -z "$dupes" ] && echo "   every local version is unique" || echo "   DUPLICATE versions: $dupes"
APPLIED=$(ls "$M" | cut -d_ -f1 | grep -vE '^(20261007120000|20261007120100)$' | tr '\n' ' ')
cli migration repair --status applied $APPLIED >/dev/null
echo "   tables in the rehearsal database after repair (must be 0): $(psql "$BASE/$DB" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
cli migration list | grep -oE '"local":"[0-9]*","remote":"[0-9]*"' | awk -F'"' '$4 != $8 { print "   mismatch: local=" $4 " remote=" $8 }'
echo "   db push now (expected: refuses until someone deliberately passes --include-all for the two cron files):"
cli db push --dry-run | grep -vE "^(DRY RUN|Connecting)" | cut -c1-300 | sed "s/^/   /"
