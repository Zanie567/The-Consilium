#!/usr/bin/env bash
#
# Verifies a backup made by take-supabase-backup.sh. READ-ONLY: it reads the backup folder and touches nothing else
# (no network, no database, no Docker).
#
#   scripts/backup/verify-supabase-backup.sh DIR --counts-before before.csv [--counts-after after.csv]
#
# What "verified" means here, and what it does not:
#   * the three files exist, are owner-only, match their recorded SHA-256, and were not cut short;
#   * schema.sql defines every table production has, and data.sql has a data block for each of them;
#   * the number of rows actually INSIDE each data block equals the live row count you exported from the production
#     SQL editor (scripts/backup/table-row-counts.sql) before the dump (and after it, if given: the backup must lie
#     between the two, which allows for rows written while the dump ran);
#   * no file contains a connection string.
# It does NOT restore the backup. A restore into a scratch database (docs/remediation/backup-and-verify.md, step 7)
# is the stronger proof and is recommended.
#
# Exit status 0 only if every check passed. Compatible with the Bash 3.2 that macOS ships.

set -euo pipefail

EXPECTED_TABLES="accounts admin_notes article_notes article_tags article_views articles ArticleTrophy audit_logs bookmarks categories category_editors comment_upvotes comments contact_messages debate_votes debates glossary_terms login_attempts notifications password_reset_tokens prediction_events predictions reading_progress series sessions site_settings site_views subscribers tags team_members team_memberships testing_sessions user_warnings users verification_tokens writer_achievements writer_streaks"

DIR=""
BEFORE=""
AFTER=""
FAILS=0
PASSES=0

pass() { PASSES=$((PASSES + 1)); echo "  PASS  $*"; }
fail() { FAILS=$((FAILS + 1)); echo "  FAIL  $*"; }
info() { echo "  info  $*"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --counts-before) [ "$#" -ge 2 ] || { echo "--counts-before needs a file" >&2; exit 2; }; BEFORE="$2"; shift 2 ;;
    --counts-after)  [ "$#" -ge 2 ] || { echo "--counts-after needs a file" >&2; exit 2; }; AFTER="$2"; shift 2 ;;
    -h|--help)       sed -n '2,22p' "$0"; exit 0 ;;
    -*)              echo "unknown option: $1" >&2; exit 2 ;;
    *)               [ -z "$DIR" ] || { echo "only one folder may be given" >&2; exit 2; }; DIR="$1"; shift ;;
  esac
done
[ -n "$DIR" ] || { echo "Usage: verify-supabase-backup.sh DIR --counts-before before.csv [--counts-after after.csv]" >&2; exit 2; }
[ -d "$DIR" ] || { echo "not a folder: $DIR" >&2; exit 2; }

mode_of() {
  if [ "$(uname)" = Darwin ]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi
}
owner_only() { local m; m=$(mode_of "$1"); [ "${m#?}" = "00" ]; }

echo "Verifying: $DIR"
echo

# ── 1. files, permissions, checksums ────────────────────────────────────────────────────────────────
echo "1. Files"
for f in schema.sql data.sql roles.sql MANIFEST.sha256 MANIFEST.txt; do
  if [ -s "$DIR/$f" ]; then pass "$f exists and is not empty"; else fail "$f is missing or empty"; fi
done
if owner_only "$DIR"; then pass "folder is owner-only"; else fail "folder is readable by others (expected mode 700)"; fi
for f in schema.sql data.sql roles.sql; do
  if [ -f "$DIR/$f" ]; then
    if owner_only "$DIR/$f"; then pass "$f is owner-only"; else fail "$f is readable by others (expected mode 600)"; fi
  fi
done
if [ -s "$DIR/MANIFEST.sha256" ]; then
  if ( cd "$DIR" && shasum -a 256 -c MANIFEST.sha256 >/dev/null 2>&1 ); then pass "SHA-256 of all three files matches the manifest"; else fail "SHA-256 does not match the manifest: a file was changed or damaged after it was written"; fi
fi

# ── 2. not cut short, no credentials ────────────────────────────────────────────────────────────────
echo
echo "2. Completeness and secrecy"
for f in schema.sql data.sql; do
  if [ -s "$DIR/$f" ]; then
    if tail -n 15 "$DIR/$f" | grep -q 'PostgreSQL database dump complete'; then pass "$f ends with pg_dump's completion marker"; else fail "$f does NOT end with the completion marker: it was cut short"; fi
  fi
done
for f in schema.sql data.sql roles.sql; do
  if [ -s "$DIR/$f" ]; then
    if grep -Eq 'postgres(ql)?://[^[:space:]/]+:[^[:space:]@]+@' "$DIR/$f"; then fail "$f contains something that looks like a connection string with a password"; else pass "$f contains no connection string"; fi
  fi
done
if [ -s "$DIR/roles.sql" ]; then
  if grep -Eqi "PASSWORD[[:space:]]+'" "$DIR/roles.sql"; then fail "roles.sql contains a role password"; else pass "roles.sql contains no role password"; fi
fi

# ── 3. structure: every table is defined and has a data block ───────────────────────────────────────
echo
echo "3. Structure"
SCHEMA_TABLES=$(tr -d '"' < "$DIR/schema.sql" 2>/dev/null | sed -n -E 's/^CREATE TABLE (IF NOT EXISTS )?public\.([A-Za-z0-9_]+).*/\2/p' | sort -u || true)
COUNTS_TSV=$(mktemp)
trap 'rm -f "$COUNTS_TSV" "$COUNTS_TSV.before" "$COUNTS_TSV.after"' EXIT
parse_csv() {  # name,count  ->  name <tab> count ; tolerant of quotes, CRLF and a header line
  tr -d '"\r' < "$1" | awk -F, 'NF >= 2 && $2 ~ /^[0-9]+$/ { print $1 "\t" $2 }'
}
# The tables to check: the built-in list (a floor, so a table cannot be dropped from the export unnoticed) PLUS every
# table that appears in the live counts. Tables added by later migrations are therefore checked too, not just listed.
CHECK_TABLES="$EXPECTED_TABLES"
LIVE_ONLY=""
for f in "$BEFORE" "$AFTER"; do
  [ -n "$f" ] && [ -s "$f" ] || continue
  for t in $(parse_csv "$f" | cut -f1); do
    case " $CHECK_TABLES " in *" $t "*) ;; *) CHECK_TABLES="$CHECK_TABLES $t"; LIVE_ONLY="$LIVE_ONLY $t" ;; esac
  done
done
[ -z "$LIVE_ONLY" ] || info "also checking tables found in the live counts but not in this script's built-in list:$LIVE_ONLY"
# one line per COPY block: table <tab> number of rows inside it
tr -d '"' < "$DIR/data.sql" 2>/dev/null | awk '
  /^COPY public\.[A-Za-z0-9_]+ / { line = $2; sub(/^public\./, "", line); name = line; inblock = 1; n = 0; next }
  inblock && /^\\\.$/            { print name "\t" n; inblock = 0; next }
  inblock                        { n++ }
' > "$COUNTS_TSV" || true

missing_schema=""
missing_data=""
for t in $CHECK_TABLES; do
  echo "$SCHEMA_TABLES" | grep -qx "$t" || missing_schema="$missing_schema $t"
  awk -F'\t' -v t="$t" '$1 == t { found = 1 } END { exit found ? 0 : 1 }' "$COUNTS_TSV" || missing_data="$missing_data $t"
done
n_expected=$(echo "$CHECK_TABLES" | wc -w | tr -d ' ')
if [ -z "$missing_schema" ]; then pass "schema.sql defines all $n_expected expected tables"; else fail "schema.sql is missing:$missing_schema"; fi
if [ -z "$missing_data" ];   then pass "data.sql has a data block for all $n_expected expected tables"; else fail "data.sql has no data block for:$missing_data"; fi
extra=""
for t in $SCHEMA_TABLES; do
  case " $CHECK_TABLES " in *" $t "*) ;; *) extra="$extra $t" ;; esac
done
[ -z "$extra" ] || info "tables in the backup that are not in the live counts and not checked (fine if they are new):$extra"

# ── 4. row counts against production ────────────────────────────────────────────────────────────────
echo
echo "4. Row counts: the rows inside the backup versus the live database"
if [ -z "$BEFORE" ]; then
  fail "no --counts-before file: the row counts cannot be checked against production (export scripts/backup/table-row-counts.sql)"
elif [ ! -s "$BEFORE" ]; then
  fail "--counts-before file is missing or empty: $BEFORE"
else
  parse_csv "$BEFORE" > "$COUNTS_TSV.before"
  if [ -n "$AFTER" ]; then
    [ -s "$AFTER" ] || { fail "--counts-after file is missing or empty: $AFTER"; }
    parse_csv "$AFTER" > "$COUNTS_TSV.after" 2>/dev/null || : > "$COUNTS_TSV.after"
  else
    cp "$COUNTS_TSV.before" "$COUNTS_TSV.after"
    info "no --counts-after: the backup must match the 'before' counts exactly"
  fi
  lookup() { awk -F'\t' -v t="$2" '$1 == t { print $2; exit }' "$1"; }
  printf '  %-26s %10s %10s %10s  %s\n' "table" "backup" "before" "after" "result"
  bad=0
  for t in $CHECK_TABLES; do
    d=$(lookup "$COUNTS_TSV" "$t"); b=$(lookup "$COUNTS_TSV.before" "$t"); a=$(lookup "$COUNTS_TSV.after" "$t")
    if [ -z "$d" ] || [ -z "$b" ] || [ -z "$a" ]; then
      printf '  %-26s %10s %10s %10s  %s\n' "$t" "${d:--}" "${b:--}" "${a:--}" "MISSING"; bad=$((bad + 1)); continue
    fi
    lo=$b; hi=$a; [ "$a" -lt "$b" ] && { lo=$a; hi=$b; }
    if [ "$d" -ge "$lo" ] && [ "$d" -le "$hi" ]; then
      printf '  %-26s %10s %10s %10s  %s\n' "$t" "$d" "$b" "$a" "ok"
    else
      printf '  %-26s %10s %10s %10s  %s\n' "$t" "$d" "$b" "$a" "MISMATCH"; bad=$((bad + 1))
    fi
  done
  if [ "$bad" -eq 0 ]; then pass "every table's backed-up row count lies within the live counts taken before and after the dump"; else fail "$bad table(s) disagree with the live counts (see above). Re-take the counts and the backup in a quiet minute, and check which table differs"; fi
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "RESULT: VERIFIED. $PASSES checks passed, 0 failed."
  echo "This proves the files are complete and hold the same NUMBER of rows per table as the live database. It does not compare row contents, and it is not a restore test: a restore is stronger; see the guide."
  exit 0
fi
echo "RESULT: NOT VERIFIED. $FAILS check(s) failed, $PASSES passed. Do NOT apply any migration on the strength of this backup."
exit 1
