#!/usr/bin/env bash
#
# Restores a backup made by take-supabase-backup.sh into a DISPOSABLE local Supabase Postgres container and proves
# what came back. It never connects to any hosted database: the only database it touches is the container it starts,
# which has no published port and is removed at the end.
#
#   scripts/backup/restore-rehearsal.sh BACKUP_DIR --evidence DIR [--expected-fingerprint prod-fingerprint.csv]
#                                       [--expected-critical prod-critical.csv] [--image IMAGE] [--keep]
#
# What it restores: the public schema (every application table, its rows, constraints, indexes, triggers, functions,
# policies and grants). It deliberately SKIPS the data of Supabase's platform schemas (auth, storage, ...): those
# tables are created and migrated by the Auth and Storage services, not by the Postgres image, so a bare image cannot
# load them (the strict restore of 2026-10-13 failed only there). It reports how many rows it skipped.
#
# Privileges: the Supabase image's default privileges grant anon, authenticated and service_role ALL on every new
# table and EXECUTE on every new function in public. Production revoked anon/authenticated on every table and on the
# SECURITY DEFINER trigger functions, and keeps the scheduler's table and functions (scheduler_invocations,
# invoke_publish_scheduled, reconcile_scheduler_invocations) owner-only, without service_role. pg_dump records only
# the grants that exist, never the image defaults it would need to undo, so BEFORE schema.sql runs those image
# defaults are revoked for all three roles; tables and functions are then created with exactly the grants the dump
# records (it grants anon/authenticated/service_role explicitly where production does, and restores production's own
# default privileges at the end), and no table is ever, even inside the transaction, readable by anon.
#
# Checks (each must pass; the evidence folder keeps the details, owner-only):
#   1. strict load: schema + data in ONE transaction with ON_ERROR_STOP;
#   2. verify-supabase-backup.sh against the restored row counts (must match the dump exactly);
#   3. content: for every public table, the sorted rows in the dump and in the restored table have the same md5;
#   4. referential integrity: no foreign key has an orphan row (data loads with triggers off);
#   5. security: anon/authenticated hold no table privilege; if --expected-fingerprint is given (production's
#      scripts/backup/security-fingerprint.sql export), every line except the extension list must be identical;
#   6. if --expected-critical is given (production's scripts/backup/critical-fingerprint.sql export taken right after
#      the dump), the critical counts and id fingerprints must be identical.
# Nothing it prints contains row contents: only table names, counts, md5s and the first error line, if any.
#
# Exit status 0 only if every check passed. Compatible with the Bash 3.2 that macOS ships.

set -euo pipefail
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP=""
EVIDENCE=""
EXPECTED_FP=""
EXPECTED_CRITICAL=""
IMAGE=""
KEEP=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --evidence)             [ "$#" -ge 2 ] || { echo "--evidence needs a folder" >&2; exit 2; }; EVIDENCE="$2"; shift 2 ;;
    --expected-fingerprint) [ "$#" -ge 2 ] || { echo "--expected-fingerprint needs a file" >&2; exit 2; }; EXPECTED_FP="$2"; shift 2 ;;
    --expected-critical)    [ "$#" -ge 2 ] || { echo "--expected-critical needs a file" >&2; exit 2; }; EXPECTED_CRITICAL="$2"; shift 2 ;;
    --image)                [ "$#" -ge 2 ] || { echo "--image needs a name" >&2; exit 2; }; IMAGE="$2"; shift 2 ;;
    --keep)                 KEEP=1; shift ;;
    -h|--help)              sed -n '2,31p' "$0"; exit 0 ;;
    -*)                     echo "unknown option: $1" >&2; exit 2 ;;
    *)                      [ -z "$BACKUP" ] || { echo "only one backup folder may be given" >&2; exit 2; }; BACKUP="$1"; shift ;;
  esac
done
[ -n "$BACKUP" ] && [ -n "$EVIDENCE" ] || { echo "Usage: restore-rehearsal.sh BACKUP_DIR --evidence DIR [--expected-fingerprint F] [--expected-critical F]" >&2; exit 2; }
for f in schema.sql data.sql; do [ -s "$BACKUP/$f" ] || { echo "not a backup folder (no $f): $BACKUP" >&2; exit 2; }; done
for f in "$EXPECTED_FP" "$EXPECTED_CRITICAL"; do [ -z "$f" ] || [ -s "$f" ] || { echo "missing file: $f" >&2; exit 2; }; done
mkdir -p "$EVIDENCE"
for f in restore.log restored-counts.csv verify-restored.txt content.txt fingerprint.csv critical.csv summary.txt; do
  [ ! -e "$EVIDENCE/$f" ] || { echo "refusing to overwrite $EVIDENCE/$f: use a new evidence folder" >&2; exit 2; }
done
command -v docker >/dev/null || { echo "docker is not installed (see docs/remediation/backup-and-verify.md, step 1)" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "cannot reach the Docker daemon: start it (colima start) and retry" >&2; exit 2; }
if [ -z "$IMAGE" ]; then
  IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'supabase/postgres:' | head -1 || true)
  [ -n "$IMAGE" ] || { echo "no supabase/postgres image found locally: pass --image (for example public.ecr.aws/supabase/postgres:17.11.0.004)" >&2; exit 2; }
fi

FAILS=0
pass() { echo "  PASS  $*" | tee -a "$EVIDENCE/summary.txt"; }
fail() { FAILS=$((FAILS + 1)); echo "  FAIL  $*" | tee -a "$EVIDENCE/summary.txt"; }
info() { echo "  info  $*" | tee -a "$EVIDENCE/summary.txt"; }

NAME="consilium-restore-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() { if [ "$KEEP" = 1 ]; then echo "  kept container $NAME (remove with: docker rm -f $NAME)"; else docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

{ echo "Restore rehearsal of $(basename "$BACKUP")"; echo "Image: $IMAGE"; echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; } | tee "$EVIDENCE/summary.txt"
# A random local-only password; the container publishes no port, so only `docker exec` reaches it.
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="local-$RANDOM$RANDOM" "$IMAGE" >/dev/null
# The image first runs its init scripts on a temporary server, then restarts. Connecting before the restart is
# unreliable (roles and Supabase's parameter permissions are not final yet), so wait for the restart to finish.
ready=0
for _ in $(seq 1 120); do
  if grep -q 'init process complete' <<<"$(docker logs "$NAME" 2>&1)" \
     && docker exec "$NAME" psql -U postgres -d postgres -Atc 'set session_replication_role = replica' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "the disposable container did not become ready (docker logs $NAME)" >&2; exit 1; }
psql_in() { docker exec -i "$NAME" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"; }

# Keeps only public-schema data: drops COPY blocks and setval calls for any other schema (auth, storage, ...).
public_data_only() {
  awk '
    /^COPY / { skip = ($2 !~ /^"?public"?\./); if (skip) { next } }
    skip && /^\\\.$/ { skip = 0; next }
    skip { next }
    /^SELECT pg_catalog\.setval\(/ && $0 !~ /setval\(.\"?public\"?\./ { next }
    { print }
  ' "$BACKUP/data.sql"
}
skipped_report() {
  awk '
    /^COPY / { schema = $2; sub(/\..*/, "", schema); gsub(/"/, "", schema); inb = (schema != "public"); if (inb) blocks[schema]++; next }
    inb && /^\\\.$/ { inb = 0; next }
    inb { rows[schema]++ }
    END { for (s in blocks) printf "%s: %d table(s), %d row(s)\n", s, blocks[s], rows[s] + 0 }
  ' "$BACKUP/data.sql" | sort
}

echo "1. Strict restore of the public schema (one transaction, ON_ERROR_STOP)" | tee -a "$EVIDENCE/summary.txt"
while IFS= read -r line; do info "skipped platform data, $line"; done < <(skipped_report)
if {
  echo "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;"
  echo "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;"
  cat "$BACKUP/schema.sql"
  echo "SET session_replication_role = replica;"
  public_data_only
} | psql_in -q --single-transaction >"$EVIDENCE/restore.log" 2>&1; then
  pass "schema and data loaded with no error"
else
  # The first error line only, with quoted values masked (a COPY error can quote row data; the log keeps the detail).
  fail "restore failed: $(grep -m1 'ERROR' "$EVIDENCE/restore.log" | sed -E "s/'[^']*'/'…'/g; s/(Key \().*/\1…/" | cut -c1-200)"
  echo "RESULT: NOT VERIFIED (details: $EVIDENCE/restore.log)" | tee -a "$EVIDENCE/summary.txt"
  exit 1
fi

echo "2. Row counts" | tee -a "$EVIDENCE/summary.txt"
psql_in --csv <"$HERE/table-row-counts.sql" >"$EVIDENCE/restored-counts.csv"
if "$HERE/verify-supabase-backup.sh" "$BACKUP" --counts-before "$EVIDENCE/restored-counts.csv" >"$EVIDENCE/verify-restored.txt" 2>&1; then
  pass "every table holds exactly the rows inside the backup ($(($(wc -l <"$EVIDENCE/restored-counts.csv") - 1)) tables)"
else
  fail "row counts differ from the backup: see $EVIDENCE/verify-restored.txt"
fi

echo "3. Row contents" | tee -a "$EVIDENCE/summary.txt"
hash() { if command -v md5sum >/dev/null; then md5sum | cut -d' ' -f1; else md5 -q; fi; }
# The rows of one public table as the dump holds them (COPY text format), never printed.
dumped_rows() {
  awk -v t="$1" '
    $1 == "COPY" && ($2 == "\"public\".\"" t "\"" || $2 == "public." t) { inb = 1; next }
    inb && /^\\\.$/ { exit }
    inb { print }' "$BACKUP/data.sql"
}
same=0; differ=0
for table in $(tail -n +2 "$EVIDENCE/restored-counts.csv" | cut -d, -f1); do
  dumped=$(dumped_rows "$table" | LC_ALL=C sort | hash)
  # pg_dump writes floats with extra_float_digits = 3; the image's session default prints the same values shorter.
  restored=$(printf 'SET extra_float_digits = 3;\n\\copy public."%s" TO STDOUT\n' "$table" | psql_in -q | LC_ALL=C sort | hash)
  echo "$table $dumped $restored" >>"$EVIDENCE/content.txt"
  if [ "$dumped" = "$restored" ]; then same=$((same + 1)); else differ=$((differ + 1)); fail "rows of $table differ from the dump"; fi
done
[ "$differ" = 0 ] && pass "all $same tables: the restored rows are byte-identical to the dump (sorted md5)"

echo "4. Referential integrity" | tee -a "$EVIDENCE/summary.txt"
orphans=$(psql_in -At 2>&1 <<'SQL'
DO $$
DECLARE fk record; n bigint; total bigint := 0;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att) AS ccols,
           (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.att) AS pcols
      FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
     WHERE c.contype = 'f' AND ns.nspname = 'public'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE ROW(%s) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE ROW(%s) = ROW(%s))',
                   fk.child, fk.ccols, fk.parent, fk.pcols, fk.ccols) INTO n;
    total := total + n;
  END LOOP;
  RAISE NOTICE 'orphans=%', total;
END $$;
SQL
)
orphans=$(echo "$orphans" | sed -n 's/.*orphans=\([0-9]*\).*/\1/p')
fks=$(psql_in -Atc "select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where c.contype = 'f' and n.nspname = 'public'")
if [ "$orphans" = 0 ]; then pass "$fks foreign keys, 0 orphan rows"; else fail "${orphans:-?} orphan row(s) across $fks foreign keys"; fi

echo "5. Security" | tee -a "$EVIDENCE/summary.txt"
public_roles=$(psql_in -Atc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace,
  aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r','p') and a.grantee in ('anon'::regrole, 'authenticated'::regrole)")
if [ "$public_roles" = 0 ]; then pass "anon and authenticated hold no table privilege"; else fail "anon/authenticated hold $public_roles table privilege(s)"; fi
psql_in --csv <"$HERE/security-fingerprint.sql" >"$EVIDENCE/fingerprint.csv"
if [ -n "$EXPECTED_FP" ]; then
  # Strip CR (a browser CSV export) and quotes, so the two exports compare by content.
  norm() { tr -d '\r"' <"$1" | grep -v '^item,' | sort; }
  while IFS=, read -r item n fp; do
    case "$item" in extensions:*) continue ;; esac
    want=$(norm "$EXPECTED_FP" | grep -F "$item," | head -1 || true)
    if [ "$want" = "$item,$n,$fp" ]; then pass "$item ($n) matches production"
    elif [ -z "$want" ]; then fail "$item: not in the production export"
    else fail "$item differs: restored $n/$fp, production ${want#"$item",}"; fi
  done < <(norm "$EVIDENCE/fingerprint.csv")
  missing=$(comm -23 <(norm "$EXPECTED_FP" | cut -d, -f1 | grep -v '^extensions:') <(norm "$EVIDENCE/fingerprint.csv" | cut -d, -f1) || true)
  [ -z "$missing" ] || fail "missing in the restored copy: $missing"
  info "extensions (informational; the hosted project and the image differ): production '$(norm "$EXPECTED_FP" | grep '^extensions:' | cut -d, -f1)', restored '$(norm "$EVIDENCE/fingerprint.csv" | grep '^extensions:' | cut -d, -f1)'"
else
  info "no --expected-fingerprint given: production's privileges, policies and triggers were NOT compared"
fi

echo "6. Critical content" | tee -a "$EVIDENCE/summary.txt"
if ! psql_in --csv <"$HERE/critical-fingerprint.sql" >"$EVIDENCE/critical.csv" 2>&1; then
  fail "the critical fingerprint query failed on the restored copy: $(grep -m1 ERROR "$EVIDENCE/critical.csv" | cut -c1-160)"
elif [ -n "$EXPECTED_CRITICAL" ]; then
  if diff <(tr -d '\r"' <"$EXPECTED_CRITICAL" | grep -v '^item,' | sort) <(tr -d '\r"' <"$EVIDENCE/critical.csv" | grep -v '^item,' | sort) >/dev/null; then
    pass "critical counts and id fingerprints equal production's"
  else
    fail "critical counts or id fingerprints differ from production's: compare $EXPECTED_CRITICAL with $EVIDENCE/critical.csv"
  fi
else
  info "no --expected-critical given: restored values are in $EVIDENCE/critical.csv"
fi

echo | tee -a "$EVIDENCE/summary.txt"
if [ "$FAILS" = 0 ]; then
  echo "RESULT: RESTORE VERIFIED (public schema, into a disposable local container; NOT a hosted recovery)" | tee -a "$EVIDENCE/summary.txt"
else
  echo "RESULT: NOT VERIFIED ($FAILS failed check(s))" | tee -a "$EVIDENCE/summary.txt"
  exit 1
fi
