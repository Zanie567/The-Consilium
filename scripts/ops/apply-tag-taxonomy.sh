#!/usr/bin/env bash
#
# Applies supabase/migrations/20261115120000_tag_taxonomy.sql to the PRODUCTION database, safely:
#
#   1. reads the connection string WITHOUT echoing it (paste it at the prompt; it is never printed,
#      logged or written to disk, and is unset on exit);
#   2. refuses any database that is not the production project;
#   3. read-only preflight (required function present, nothing half-applied, no unusable tag names);
#   4. applies the migration in ONE transaction (all or nothing);
#   5. verifies every object it adds and that no existing row changed (tag and link counts, before = after);
#   6. records the version in supabase_migrations.schema_migrations.
#
# Take a backup first (scripts/backup/take-supabase-backup.sh). Run from the repository root:
#   bash scripts/ops/apply-tag-taxonomy.sh
# For a rehearsal against a local copy: APPLY_TAGS_ALLOW_LOCAL=1 DIRECT_URL=postgresql://... bash scripts/ops/apply-tag-taxonomy.sh
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
MIGRATION=supabase/migrations/20261115120000_tag_taxonomy.sql
VERSION=20261115120000
EXPECTED_REF=scllbuwkcqtmfogsgalt
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"; [ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
command -v psql >/dev/null || { echo "psql is not installed (brew install postgresql@16)" >&2; exit 1; }
[ -f "$MIGRATION" ] || { echo "Run from the repository root of the feat/tag-taxonomy branch." >&2; exit 1; }

URL="${DIRECT_URL:-}"
trap 'unset URL' EXIT
if [ -z "$URL" ]; then
  printf 'Paste the production DIRECT_URL (Supabase > Project Settings > Database, session pooler or direct), then Enter: ' >&2
  IFS= read -rs URL; echo >&2
fi
[ -n "$URL" ] || { echo "No connection string given." >&2; exit 1; }
if [ "${APPLY_TAGS_ALLOW_LOCAL:-0}" = 1 ]; then
  case "$URL" in *@127.0.0.1:*|*@localhost:*) echo "→ rehearsal against a LOCAL database" >&2 ;; *) echo "APPLY_TAGS_ALLOW_LOCAL is only for local databases." >&2; exit 1 ;; esac
else
  case "$URL" in *"$EXPECTED_REF"*) ;; *) echo "That is not the production project ($EXPECTED_REF). Nothing was done." >&2; exit 1 ;; esac
fi
q() { psql "$URL" -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }
# Booleans joined into text read "true"/"false"; on their own, "t"/"f".
yes() { [ "$1" = t ] || [ "$1" = true ]; }

echo "→ preflight (read-only)" >&2
PRE="$(q <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT (to_regprocedure('public.consilium_tag_identity(text)') IS NOT NULL)
    || '|' || (to_regclass('public.tag_aliases') IS NULL AND to_regclass('public.tag_suggestions') IS NULL)
    || '|' || (SELECT count(*) FROM tags WHERE public.consilium_tag_identity(name) = '')
    || '|' || (SELECT count(*) FROM tags) || '|' || (SELECT count(*) FROM article_tags)
    || '|' || (SELECT count(*) FROM tags WHERE char_length(name) > 80);
COMMIT;
SQL
)"
IFS='|' read -r HAS_FN FRESH EMPTY TAGS LINKS LONG <<<"$PRE"
echo "  identity function present: $HAS_FN; not yet applied: $FRESH; tags: $TAGS; article links: $LINKS" >&2
yes "$HAS_FN" || { echo "✗ public.consilium_tag_identity is missing (apply 20261006153514 first). Nothing was done." >&2; exit 1; }
[ "$EMPTY" = 0 ] || { echo "✗ $EMPTY tag(s) have no usable name. Nothing was done." >&2; exit 1; }
yes "$FRESH" || echo "  (already partly applied: the migration is idempotent and will complete it)" >&2

echo "→ applying $MIGRATION in one transaction" >&2
psql "$URL" -X -q -v ON_ERROR_STOP=1 -1 -f "$MIGRATION" 2>&1 | grep -v NOTICE >&2 || true

echo "→ verifying" >&2
POST="$(q <<'SQL'
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tags' AND column_name IN ('description','retiredAt','mergedIntoId'))
    || '|' || (to_regclass('public.tag_aliases') IS NOT NULL AND to_regclass('public.tag_suggestions') IS NOT NULL)
    || '|' || (SELECT count(*) FROM pg_trigger WHERE tgname IN ('tag_aliases_guard','tags_alias_guard'))
    || '|' || (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.tag_aliases'::regclass, 'public.tag_suggestions'::regclass))
    || '|' || (SELECT count(*) FROM tags) || '|' || (SELECT count(*) FROM article_tags)
    || '|' || (SELECT count(*) FROM tags WHERE "retiredAt" IS NOT NULL OR "mergedIntoId" IS NOT NULL OR description IS NOT NULL);
SQL
)"
IFS='|' read -r COLS TABLES TRIGGERS RLS TAGS2 LINKS2 MARKED <<<"$POST"
ok=1
[ "$COLS" = 3 ] || { echo "✗ tags columns: $COLS of 3" >&2; ok=0; }
yes "$TABLES" || { echo "✗ alias/suggestion tables missing" >&2; ok=0; }
[ "$TRIGGERS" = 2 ] || { echo "✗ triggers: $TRIGGERS of 2" >&2; ok=0; }
yes "$RLS" || { echo "✗ row-level security is not on" >&2; ok=0; }
[ "$TAGS2" = "$TAGS" ] && [ "$LINKS2" = "$LINKS" ] && [ "$MARKED" = 0 ] || { echo "✗ existing rows changed (tags $TAGS→$TAGS2, links $LINKS→$LINKS2, marked $MARKED)" >&2; ok=0; }
[ "$ok" = 1 ] || { echo "Verification FAILED. Rollback: supabase/manual/20261115120000_tag_taxonomy_rollback.sql" >&2; exit 1; }
echo "  ✓ columns, tables, triggers and RLS in place; $TAGS2 tags and $LINKS2 article links unchanged" >&2

echo "→ recording $VERSION in the migration registry" >&2
q -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$VERSION', 'tag_taxonomy') ON CONFLICT (version) DO NOTHING" >/dev/null \
  && echo "  ✓ registry: $(q -c "SELECT count(*) FROM supabase_migrations.schema_migrations") rows" >&2 \
  || echo "  ! could not write the registry row (the migration itself is applied). Record it with: supabase migration repair --status applied $VERSION" >&2
echo "✅ Done. Tell Claude it is applied; #198 can now be merged." >&2
