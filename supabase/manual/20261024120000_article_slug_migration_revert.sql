-- Revert ONE applied article address migration (scripts/migrate-article-slugs.ts): every article in it
-- gets its old address back and that migration's redirect rows are removed. Owner-run only, after approval.
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -v migration_id='2026-10-24-launch-articles' \
--        -f supabase/manual/20261024120000_article_slug_migration_revert.sql
--
-- Effect on readers: the old addresses work again directly; the new addresses then 404 (anyone who already
-- followed a 301 cached it permanently and will see a 404, so do this only soon after the migration).
-- Every step is checked; any mismatch aborts the whole transaction and changes nothing.

\set ON_ERROR_STOP on
BEGIN;

-- The two guarded steps: a locked address may change only inside a declared migration, and redirect rows can
-- only be removed with the guard trigger paused for this transaction.
SELECT set_config('consilium.article_slug_migration', 'on', true);
ALTER TABLE article_slug_redirects DISABLE TRIGGER article_slug_redirects_guard;

CREATE TEMP TABLE revert_plan ON COMMIT DROP AS
SELECT r."articleId", r."oldSlug", a.slug AS "currentSlug"
  FROM article_slug_redirects r JOIN articles a ON a.id = r."articleId"
 WHERE r."migrationId" = :'migration_id';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM revert_plan;
  IF n = 0 THEN RAISE EXCEPTION 'No redirects recorded for this migration id'; END IF;
  -- No other article may have taken an old address in the meantime (the guard prevents it; check anyway).
  IF EXISTS (SELECT 1 FROM revert_plan p JOIN articles a ON a.slug = p."oldSlug") THEN
    RAISE EXCEPTION 'An old address is in use by an article; nothing reverted';
  END IF;
END $$;

DELETE FROM article_slug_redirects WHERE "migrationId" = :'migration_id';
UPDATE articles a SET slug = p."oldSlug" FROM revert_plan p WHERE a.id = p."articleId" AND a.slug = p."currentSlug";

INSERT INTO audit_logs (id, action, "targetId", "targetType", "performedBy", metadata, "createdAt")
SELECT 'slugrev_' || p."articleId" || '_' || md5(clock_timestamp()::text), 'article.slug_migration_reverted', p."articleId", 'article',
       'manual:owner', jsonb_build_object('migrationId', :'migration_id', 'before', p."currentSlug", 'after', p."oldSlug"), now()
  FROM revert_plan p;

ALTER TABLE article_slug_redirects ENABLE TRIGGER article_slug_redirects_guard;

SELECT a.id, a.slug, a.title FROM articles a JOIN revert_plan p ON p."articleId" = a.id;
COMMIT;
