-- Rollback for supabase/migrations/20261024120000_article_slug_redirects.sql
--
-- Run ONLY after the application has been rolled back to a build that does not read
-- articles."slugLockedAt" or article_slug_redirects (Prisma selects every column it knows, so the new
-- build fails without them).
--
-- If an article slug migration was applied, its redirects disappear with this table: the old addresses
-- would then 404. Either keep this table (drop only the triggers), or first restore the old slugs with the
-- inverse mapping recorded in audit_logs (action 'article.slug_migrated') — see
-- docs/seo/article-url-migration.md, "Rollback".
--
-- Keep a copy before dropping anything:
--   \copy (SELECT * FROM article_slug_redirects) TO 'article_slug_redirects-backup.csv' CSV HEADER

BEGIN;
DROP TRIGGER IF EXISTS articles_slug_guard ON "articles";
DROP FUNCTION IF EXISTS guard_article_slug();
DROP TRIGGER IF EXISTS article_slug_redirects_guard ON "article_slug_redirects";
DROP FUNCTION IF EXISTS protect_article_slug_redirect();
DROP TABLE IF EXISTS "article_slug_redirects";
ALTER TABLE "articles" DROP COLUMN IF EXISTS "slugLockedAt";
COMMIT;
