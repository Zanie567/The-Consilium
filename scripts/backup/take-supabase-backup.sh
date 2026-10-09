#!/usr/bin/env bash
#
# Guided, secret-safe logical backup of the PRODUCTION database with the Supabase CLI.
#
#   scripts/backup/take-supabase-backup.sh --out /Volumes/ConsiliumBackup \
#       --url-from-env-file /path/to/.env.local --var DIRECT_URL
#
# It READS the production database (three `supabase db dump` runs) and WRITES only into --out. It changes nothing
# in production. See docs/remediation/backup-and-verify.md for the whole procedure.
#
# How it keeps the credentials safe:
#   * the connection string is read silently (or from a dotenv file) into a shell variable. It is never echoed,
#     never written to a file, never put in the manifest or the log, and is unset on exit;
#   * anything the CLI prints is scrubbed of the password (and its percent-decoded form) before it is stored or shown;
#   * the output folder is created owner-only (umask 077: folder 700, files 600);
#   * it refuses an output folder inside a git repository or a cloud-synced folder (Desktop, Documents, iCloud,
#     Dropbox, Google Drive, OneDrive) unless you explicitly allow it;
#   * it refuses a database that is not this project, and a host that is not Supabase.
# One honest limit: `supabase db dump --db-url` takes the URL as a command-line argument, so for the few seconds each
# dump runs it is visible to processes of the SAME user (and root) in the process list. On a single-user personal Mac
# that is acceptable; do not run this on a shared machine.
#
# Compatible with the Bash 3.2 that macOS ships.

set -euo pipefail
umask 077

EXPECTED_REF_DEFAULT="scllbuwkcqtmfogsgalt"

OUT_PARENT=""
ENV_FILE=""
ENV_VAR=""
ALLOW_SYNCED=0
ALLOW_GIT=0
EXPECTED_REF="$EXPECTED_REF_DEFAULT"

URL=""
userinfo=""
pw=""
SCRATCH=""
trap 'unset URL userinfo pw 2>/dev/null || true; [ -n "$SCRATCH" ] && rm -rf "$SCRATCH" || true' EXIT

die()  { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "WARNING: $*" >&2; }
say()  { echo "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
Usage: take-supabase-backup.sh --out DIR [--url-from-env-file FILE --var NAME] [--project-ref REF]

  --out DIR                  Existing folder to create the backup folder in (use the encrypted volume).
  --url-from-env-file FILE   Read the connection string from a dotenv file instead of pasting it.
  --var NAME                 The variable to read from that file (for example DIRECT_URL). Required with the above.
  --project-ref REF          Expected Supabase project ref (default: the production project).
  --allow-synced-folder      Allow an output folder inside a cloud-synced location (not recommended).
  --allow-in-git-repo        Allow an output folder inside a git repository (not recommended).
EOF
}

need_arg() { [ "$#" -ge 2 ] && [ -n "$2" ] || { usage; die "option $1 needs a value"; }; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)                 need_arg "$@"; OUT_PARENT="$2"; shift 2 ;;
    --url-from-env-file)   need_arg "$@"; ENV_FILE="$2"; shift 2 ;;
    --var)                 need_arg "$@"; ENV_VAR="$2"; shift 2 ;;
    --project-ref)         need_arg "$@"; EXPECTED_REF="$2"; shift 2 ;;
    --allow-synced-folder) ALLOW_SYNCED=1; shift ;;
    --allow-in-git-repo)   ALLOW_GIT=1; shift ;;
    -h|--help)             usage; exit 0 ;;
    *)                     usage; die "unknown option: $1" ;;
  esac
done

# ── 1. tools ─────────────────────────────────────────────────────────────────────────────────────────
command -v supabase >/dev/null 2>&1 || die "the Supabase CLI is not installed. Run: brew install supabase/tap/supabase"
command -v docker   >/dev/null 2>&1 || die "Docker is not installed (the CLI runs pg_dump in a container). See the guide: install Colima."
if ! docker info >/dev/null 2>&1; then
  # Colima's socket is not on the default path; point Docker clients at it.
  if [ -S "$HOME/.colima/default/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it (for Colima: colima start) and try again."
fi
CLI_VERSION=$(supabase --version 2>/dev/null | head -1 || true)
say "Supabase CLI: ${CLI_VERSION:-unknown}"

# ── 2. output folder ─────────────────────────────────────────────────────────────────────────────────
[ -n "$OUT_PARENT" ] || { usage; die "--out is required"; }
[ -d "$OUT_PARENT" ] || die "--out is not an existing folder: $OUT_PARENT"
OUT_PARENT=$(cd "$OUT_PARENT" && pwd -P)

if [ "$ALLOW_GIT" != 1 ] && command -v git >/dev/null 2>&1 && git -C "$OUT_PARENT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "the output folder is inside a git repository, where a backup full of personal data could be committed. Use the encrypted volume, or pass --allow-in-git-repo."
fi
if [ "$ALLOW_SYNCED" != 1 ]; then
  case "$OUT_PARENT" in
    "$HOME/Desktop"|"$HOME/Desktop/"*|"$HOME/Documents"|"$HOME/Documents/"*|*"/Library/Mobile Documents/"*|*"/Library/CloudStorage/"*|*"iCloud"*|*"Dropbox"*|*"Google Drive"*|*"OneDrive"*)
      die "the output folder looks cloud-synced ($OUT_PARENT). A backup holds subscriber emails and password hashes: keep it on the encrypted volume, or pass --allow-synced-folder." ;;
  esac
fi
if command -v fdesetup >/dev/null 2>&1; then
  fdesetup status 2>/dev/null | grep -q "FileVault is On" || warn "FileVault is not on. Turn it on (System Settings > Privacy & Security) before keeping personal data on this Mac."
fi

# ── 3. the connection string (never printed) ────────────────────────────────────────────────────────
if [ -n "$ENV_FILE" ]; then
  [ -n "$ENV_VAR" ] || die "--var is required with --url-from-env-file"
  case "$ENV_VAR" in *[!A-Z0-9_]*|"") die "--var must look like DIRECT_URL" ;; esac
  [ -f "$ENV_FILE" ] || die "not a file: $ENV_FILE"
  URL=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${ENV_VAR}=(.*)\$/\\2/p" "$ENV_FILE" | head -1)
  URL=${URL%\"}; URL=${URL#\"}; URL=${URL%\'}; URL=${URL#\'}
  [ -n "$URL" ] || die "$ENV_VAR is not set in $ENV_FILE"
  say "Read $ENV_VAR from $ENV_FILE (value not shown)."
else
  printf 'Paste the PRODUCTION connection string (typing is hidden), then press Enter: ' >&2
  IFS= read -rs URL || true
  echo >&2
  [ -n "$URL" ] || die "nothing was entered"
fi

case "$URL" in
  postgres://*|postgresql://*) ;;
  *) die "that does not look like a Postgres connection string (it must start with postgresql://)" ;;
esac

rest=${URL#*://}
base=${rest%%\?*}
query_removed=0
[ "$base" != "$rest" ] && query_removed=1
base=${base%%#*}
case "$base" in *@*) ;; *) die "the connection string has no user and password" ;; esac
userinfo=${base%@*}
hostpath=${base##*@}
case "$userinfo" in *:*) ;; *) die "the connection string has no password" ;; esac
case "$userinfo" in *@*) die "the password contains an unencoded @. Percent-encode it as %40 (the Supabase CLI requires a percent-encoded URL)." ;; esac
user=${userinfo%%:*}
pw=${userinfo#*:}
[ -n "$user" ] && [ -n "$pw" ] || die "the connection string is missing the user or the password"
if printf '%s' "$pw" | grep -q '[^A-Za-z0-9._~%!$&()*+,;=:-]'; then
  die "the password contains characters that must be percent-encoded in a URL (for example / ? # [ ] @ space). Encode them, then retry."
fi
hostport=${hostpath%%/*}
case "$hostpath" in */*) dbname=${hostpath#*/} ;; *) dbname="" ;; esac
dbname=${dbname%%/*}
host=${hostport%%:*}
case "$hostport" in *:*) port=${hostport##*:} ;; *) port=5432 ;; esac
case "$port" in ""|*[!0-9]*) die "the port in the connection string is not a number" ;; esac
[ -n "$host" ] || die "the connection string has no host"
[ -n "$dbname" ] || dbname=postgres

if [ "${CONSILIUM_BACKUP_ALLOW_ANY_HOST:-0}" != 1 ]; then
  case "$host" in
    *.supabase.co|*.supabase.com) ;;
    *) die "the host ($host) is not a Supabase host. Refusing: this tool backs up the production Supabase project only." ;;
  esac
fi

# Which project is this? Refuse any other.
ref=""
case "$user" in postgres.*) ref=${user#postgres.} ;; esac
case "$host" in db.*.supabase.co) h=${host#db.}; ref=${h%%.*} ;; esac
if [ -n "$EXPECTED_REF" ] && [ "$ref" != "$EXPECTED_REF" ]; then
  die "this connection string is for project '${ref:-unknown}', not '$EXPECTED_REF'. Refusing."
fi

# Prisma-style URLs carry ?pgbouncer=true etc., which pg_dump rejects. Transaction mode (6543) cannot run pg_dump.
if [ "$query_removed" = 1 ]; then say "Note: removed the query parameters (such as ?pgbouncer=true); pg_dump does not accept them."; fi
case "$host" in
  *.pooler.supabase.com)
    if [ "$port" = 6543 ]; then port=5432; say "Note: changed port 6543 (transaction mode) to 5432 (session mode); pg_dump needs session mode."; fi ;;
esac
URL="postgresql://${userinfo}@${host}:${port}/${dbname}?sslmode=require"
say "Target: user=$user host=$host port=$port database=$dbname project=${ref:-unknown} (password hidden, TLS required)"

case "$host" in
  db.*.supabase.co) say "Note: this is the DIRECT host, which is IPv6-only on the Free plan. If the connection fails, use the Session pooler string from Dashboard > Connect instead." ;;
esac
if [ "${CONSILIUM_BACKUP_SKIP_CONNECTIVITY:-0}" != 1 ] && command -v nc >/dev/null 2>&1; then
  nc -z -w 8 "$host" "$port" >/dev/null 2>&1 || die "cannot reach $host:$port. On the direct host this usually means your network is IPv4-only: use the Session pooler connection string (Dashboard > Connect > Session pooler, port 5432)."
fi

# ── 4. dump ─────────────────────────────────────────────────────────────────────────────────────────
SCRATCH=$(mktemp -d)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$OUT_PARENT/consilium-prod-$STAMP"
mkdir "$DEST"
LOG="$DEST/backup.log"
: > "$LOG"

decoded_pw=$(printf '%b' "${pw//%/\\x}" 2>/dev/null || printf '%s' "$pw")

scrub() {
  # replace the password (and its percent-decoded form) in whatever the CLI printed
  BACKUP_SCRUB_A="$pw" BACKUP_SCRUB_B="$decoded_pw" awk '
    function rep(s, needle,   i) { if (needle == "") return s; while ((i = index(s, needle)) > 0) s = substr(s, 1, i-1) "****" substr(s, i + length(needle)); return s }
    { print rep(rep($0, ENVIRON["BACKUP_SCRUB_A"]), ENVIRON["BACKUP_SCRUB_B"]) }'
}

run_dump() {
  # run_dump "label" FILE [cli flags...]
  local name=$1 file=$2; shift 2
  local errfile="$DEST/.cli-output.$$"
  say "-> $name"
  local rc=0
  # Run from an empty scratch folder so the CLI cannot pick up a stale supabase/ config or link state from
  # wherever this was started (an old recorded Postgres version makes pg_dump refuse a newer server).
  # Keep BOTH streams: the CLI reports some errors (for example an invalid flag combination) on stdout, and
  # discarding stdout once hid the real reason for a failure.
  ( cd "$SCRATCH" && supabase db dump --db-url "$URL" -f "$file" "$@" ) >"$errfile" 2>&1 || rc=$?
  { echo "== $name (exit $rc)"; scrub < "$errfile"; } >> "$LOG"
  if [ "$rc" -ne 0 ]; then
    scrub < "$errfile" >&2
    rm -f "$errfile"
    say ""
    say "The $name dump FAILED (exit $rc). Nothing is verified. Common causes:"
    say "  - 'server version mismatch': the CLI's pg_dump is older than the server (17). Update it: brew upgrade supabase"
    say "  - 'password authentication failed': the password is wrong (do NOT reset it; the live site uses it)"
    say "  - 'no route to host' / timeout: use the Session pooler string (port 5432)"
    say "  - 'Cannot connect to the Docker daemon': start Colima (colima start)"
    say "The partial folder was kept for inspection: $DEST (it contains no credentials)."
    exit 1
  fi
  rm -f "$errfile"
}

# Flags, checked against Supabase CLI 2.120.0 (`supabase db dump --help`, and `--dry-run` for the generated pg_dump):
#   * --keep-comments is needed ONLY for the schema dump: without it the CLI deletes every "--" line with sed,
#     including pg_dump's "PostgreSQL database dump complete" marker that the verifier uses to detect a cut-short file.
#   * --keep-comments and --data-only are mutually exclusive in the CLI (it refuses the pair). The data dump keeps
#     its comments anyway, so it does not need the flag.
#   * the roles dump runs pg_dumpall --no-comments, so it has no marker and --keep-comments would change nothing.
run_dump "schema (structure, policies, functions)" "$DEST/schema.sql" --keep-comments
run_dump "data (every row)"                         "$DEST/data.sql"   --use-copy --data-only
run_dump "roles (cluster roles, no passwords)"      "$DEST/roles.sql"  --role-only

for f in schema.sql data.sql roles.sql; do
  [ -s "$DEST/$f" ] || die "$f is empty. The backup is NOT valid: $DEST"
  chmod 600 "$DEST/$f"
done
chmod 600 "$LOG"

# ── 5. manifest ─────────────────────────────────────────────────────────────────────────────────────
( cd "$DEST" && shasum -a 256 schema.sql data.sql roles.sql > MANIFEST.sha256 )
{
  echo "created_utc:  $STAMP"
  echo "supabase_cli: ${CLI_VERSION:-unknown}"
  echo "project_ref:  ${ref:-unknown}"
  echo "host_port:    $host:$port"
  echo "sizes_bytes:"
  ( cd "$DEST" && wc -c schema.sql data.sql roles.sql | sed 's/^/  /' )
} > "$DEST/MANIFEST.txt"
chmod 600 "$DEST/MANIFEST.sha256" "$DEST/MANIFEST.txt"

say ""
say "Backup written to: $DEST"
say "NOT yet trustworthy: it is verified only when the next step passes:"
say "  scripts/backup/verify-supabase-backup.sh \"$DEST\" --counts-before before.csv --counts-after after.csv"
printf '%s\n' "$DEST"
