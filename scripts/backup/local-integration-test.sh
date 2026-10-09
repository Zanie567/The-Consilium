#!/usr/bin/env bash
#
# End-to-end proof of the backup toolkit against a THROWAWAY local database, using the REAL Supabase CLI.
#
#   scripts/backup/local-integration-test.sh
#
# It never contacts Supabase production and needs no credentials. It:
#   1. starts a disposable Supabase Postgres container (random name, Docker-assigned local port, TLS on) and seeds
#      the 37 production table names with awkward rows (tabs, newlines, backslashes, $$);
#   2. runs take-supabase-backup.sh against it (real CLI, real pg_dump);
#   3. runs verify-supabase-backup.sh against live counts taken before and after;
#   4. restores the backup into a SECOND disposable container (the guide's step 8) and verifies against the restored counts;
#   5. proves the verifier rejects a backup when the database no longer matches it;
#   6. removes both containers and all temporary files, whatever happens.
# It only ever starts, inspects and removes containers it created itself (named consilium-backup-it-*).
#
# Needs: docker (Colima or Docker Desktop, running), the Supabase CLI, openssl, and the Supabase Postgres image
# (set CONSILIUM_BACKUP_IT_IMAGE to override; by default a local supabase/postgres image is used, else it is pulled).
# Works where containers can reach the host as host.docker.internal (Colima, Docker Desktop).
# Compatible with the Bash 3.2 that macOS ships.

set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd -P)
TAKE="$HERE/take-supabase-backup.sh"
VERIFY="$HERE/verify-supabase-backup.sh"
COUNTS_SQL="$HERE/table-row-counts.sql"
TABLES="accounts admin_notes article_notes article_tags article_views articles ArticleTrophy audit_logs bookmarks categories category_editors comment_upvotes comments contact_messages debate_votes debates glossary_terms login_attempts notifications password_reset_tokens prediction_events predictions reading_progress series sessions site_settings site_views subscribers tags team_members team_memberships testing_sessions user_warnings users verification_tokens writer_achievements writer_streaks"

SUFFIX="$$-$(date +%s)"
SRC="consilium-backup-it-src-$SUFFIX"
DST="consilium-backup-it-restore-$SUFFIX"
WORK=$(mktemp -d)
umask 077
STARTED=""
FAILED=0

cleanup() {
  for c in $STARTED; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { echo "  PASS  $*"; }
bad()  { echo "  FAIL  $*"; FAILED=$((FAILED + 1)); }
die()  { echo "ERROR: $*" >&2; exit 2; }
check() { local label=$1; shift; if "$@" >"$WORK/last.out" 2>&1; then ok "$label"; else bad "$label"; sed 's/^/        /' "$WORK/last.out" | tail -20; fi; }

command -v docker   >/dev/null 2>&1 || die "docker is not installed"
command -v supabase >/dev/null 2>&1 || die "the Supabase CLI is not installed"
command -v openssl  >/dev/null 2>&1 || die "openssl is not installed"
docker info >/dev/null 2>&1 || { [ -S "$HOME/.colima/default/docker.sock" ] && export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"; }
docker info >/dev/null 2>&1 || die "Docker is not running (for Colima: colima start)"

IMG=${CONSILIUM_BACKUP_IT_IMAGE:-$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'supabase/postgres' | head -1)}
[ -n "$IMG" ] || IMG="public.ecr.aws/supabase/postgres:17.11.0.004"
echo "Supabase CLI: $(supabase --version 2>/dev/null | head -1)   image: $IMG"

wait_ready() {  # container
  local i=0
  until docker exec "$1" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 60 ] && die "$1 did not become ready"; sleep 2
  done
}
psql_in() {  # container user -- psql args...
  local c=$1 u=$2; shift 2
  docker exec -i "$c" psql -U "$u" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

# ── 1. the throwaway "production" ────────────────────────────────────────────────────────────────────
echo; echo "1. Start and seed a throwaway database"
docker run -d --name "$SRC" -e POSTGRES_PASSWORD=throwaway-local-only -p 127.0.0.1::5432 "$IMG" >/dev/null || die "could not start $SRC"
STARTED="$SRC"
wait_ready "$SRC"
PORT=$(docker port "$SRC" 5432/tcp | head -1 | sed 's/.*://')
[ -n "$PORT" ] || die "could not find the published port"

openssl req -new -x509 -days 2 -nodes -subj /CN=localhost -keyout "$WORK/it.key" -out "$WORK/it.crt" >/dev/null 2>&1 || die "openssl failed"
docker cp "$WORK/it.key" "$SRC:/tmp/it.key" && docker cp "$WORK/it.crt" "$SRC:/tmp/it.crt" || die "docker cp failed"
docker exec -u root "$SRC" chown postgres:postgres /tmp/it.key /tmp/it.crt
docker exec -u root "$SRC" chmod 600 /tmp/it.key
psql_in "$SRC" supabase_admin -c "alter system set ssl_cert_file='/tmp/it.crt'" -c "alter system set ssl_key_file='/tmp/it.key'" -c "alter system set ssl=on" -c "select pg_reload_conf()" >/dev/null || die "could not enable TLS"
sleep 2
# a login role shaped like the pooler user (postgres.<ref>) with a percent-encoded special character in its password
psql_in "$SRC" supabase_admin -c "create role \"postgres.localtest\" login superuser password 'T3st@pw-ok'" >/dev/null || die "could not create the login role"

{
  i=0
  for t in $TABLES; do
    i=$((i + 1)); n=$((i % 5))
    echo "create table public.\"$t\" (id serial primary key, body text);"
    r=0; while [ "$r" -lt "$n" ]; do r=$((r + 1)); echo "insert into public.\"$t\"(body) values (E'row $r\\twith tab\\nand newline \\\\ backslash and \$\$ dollars');"; done
  done
  echo "insert into auth.users(id) values (gen_random_uuid());"
} | psql_in "$SRC" postgres >/dev/null || die "seeding failed"
ok "database up on 127.0.0.1:$PORT with TLS, 37 tables seeded"

printf 'DIRECT_URL="postgresql://postgres.localtest:T3st%%40pw-ok@host.docker.internal:%s/postgres?pgbouncer=true"\n' "$PORT" > "$WORK/it.env"
counts() {  # container outfile
  docker exec -i "$1" psql -U postgres -h 127.0.0.1 -d postgres --csv < "$COUNTS_SQL" > "$2"
}

# ── 2. take ──────────────────────────────────────────────────────────────────────────────────────────
echo; echo "2. Take the backup with the real Supabase CLI"
mkdir "$WORK/out"
counts "$SRC" "$WORK/before.csv" || die "could not count rows"
CONSILIUM_BACKUP_ALLOW_ANY_HOST=1 CONSILIUM_BACKUP_SKIP_CONNECTIVITY=1 \
  "$TAKE" --out "$WORK/out" --url-from-env-file "$WORK/it.env" --var DIRECT_URL --project-ref localtest > "$WORK/take.out" 2> "$WORK/take.err"
TAKE_RC=$?
if [ "$TAKE_RC" -eq 0 ]; then ok "take-supabase-backup.sh exited 0"; else bad "take-supabase-backup.sh exited $TAKE_RC"; sed 's/^/        /' "$WORK/take.err" | tail -20; fi
BACKUP=$(tail -1 "$WORK/take.out")
[ -d "$BACKUP" ] || { echo "RESULT: FAILED (no backup folder)"; exit 1; }
counts "$SRC" "$WORK/after.csv" || die "could not count rows"
check "no password reached the screen or any backup file" sh -c '! grep -rqF -e "T3st@pw-ok" -e "T3st%40pw-ok" "$0" "$1" "$2"' "$BACKUP" "$WORK/take.err" "$WORK/take.out"

# ── 3. verify against the live database ──────────────────────────────────────────────────────────────
echo; echo "3. Verify against the live counts"
check "verifier says VERIFIED (counts before and after)" "$VERIFY" "$BACKUP" --counts-before "$WORK/before.csv" --counts-after "$WORK/after.csv"

# ── 4. restore into a second throwaway database ──────────────────────────────────────────────────────
echo; echo "4. Restore into a second throwaway database (guide step 8)"
docker run -d --name "$DST" -e POSTGRES_PASSWORD=throwaway-local-only "$IMG" >/dev/null || die "could not start $DST"
STARTED="$STARTED $DST"
wait_ready "$DST"
( cat "$BACKUP/schema.sql"; echo "SET session_replication_role = replica;"; cat "$BACKUP/data.sql" ) \
  | docker exec -i "$DST" psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -q > "$WORK/restore.out" 2>&1
RESTORE_RC=$?
if [ "$RESTORE_RC" -eq 0 ]; then ok "schema.sql + data.sql restore with no error"; else bad "restore failed (exit $RESTORE_RC)"; tail -20 "$WORK/restore.out" | sed 's/^/        /'; fi
docker exec -i "$DST" psql -U postgres -d postgres --csv < "$COUNTS_SQL" > "$WORK/restored.csv"
check "verifier says VERIFIED against the RESTORED copy (exact match)" "$VERIFY" "$BACKUP" --counts-before "$WORK/restored.csv"

# ── 5. the verifier must notice a database that no longer matches ───────────────────────────────────
echo; echo "5. Negative check: the verifier rejects a mismatch"
psql_in "$SRC" postgres -c "insert into public.subscribers(body) values ('added after the backup')" >/dev/null
counts "$SRC" "$WORK/drifted.csv"
if "$VERIFY" "$BACKUP" --counts-before "$WORK/drifted.csv" > "$WORK/neg.out" 2>&1; then bad "verifier accepted a backup that is missing a row"; else ok "verifier rejects a backup that is missing a row"; fi

echo
if [ "$FAILED" -eq 0 ]; then echo "RESULT: ALL CHECKS PASSED (containers and temp files removed)"; exit 0; fi
echo "RESULT: $FAILED CHECK(S) FAILED"; exit 1
