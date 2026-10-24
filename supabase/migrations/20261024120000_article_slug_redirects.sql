-- =============================================================================
-- Migration: permanent article addresses and old-address redirects
-- Version:   20261024120000 (unique 14-digit prefix: safe for the Supabase CLI and for manual use)
-- Requires:  articles (any version)
-- =============================================================================
--
-- Additive and idempotent. Apply manually after review, in ONE transaction, BEFORE deploying the code
-- that uses it (the code reads both new objects; the currently deployed code ignores them). Never
-- `supabase db push`. Runbook: docs/seo/article-url-migration.md.
--
-- What it adds
--   * articles."slugLockedAt": when the article's web address became permanent. Set the first time an
--     article is PUBLISHED (by the application and, as a backstop, by the trigger below, whichever code
--     or SQL publishes it) and never cleared, so unpublishing does not reopen the address.
--   * table article_slug_redirects: one row per retired address ("oldSlug") of an article. The site
--     answers /articles/<oldSlug> with a 301 to the article's current address. Rows are permanent: no
--     UPDATE, and no DELETE except the cascade when the article itself is permanently deleted.
--   * trigger articles_slug_guard (articles, BEFORE INSERT OR UPDATE OF slug, status):
--       - sets "slugLockedAt" when an article becomes PUBLISHED, and keeps it once set;
--       - refuses a slug change on a locked article unless the transaction declared an authorised
--         migration with  SET LOCAL consilium.article_slug_migration = 'on'
--         (only scripts/migrate-article-slugs.ts does that, after a dry run and an approval code);
--       - refuses a slug that is a retired address of any article (it would shadow that redirect).
--   * trigger article_slug_redirects_guard: a retired address can never be a live article's slug, and
--     redirect rows cannot be edited or deleted directly.
--   * RLS on, no grants to anon/authenticated (the app connects as the table owner, as for every table).
--   * Backfill: every article that is or has been public gets "slugLockedAt" (published now, archived by
--     a debate, or ever viewed). Production 2026-10-24: 4 published + 5 trashed drafts that had views.
--
-- No article slug, status, date or content is changed by this file.
--
-- Rollback (loses the redirect rows; take a copy first if any were written):
--   supabase/manual/20261024120000_article_slug_redirects_rollback.sql
-- =============================================================================

ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "slugLockedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "article_slug_redirects" (
    "id" TEXT NOT NULL,
    "oldSlug" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "migrationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_slug_redirects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "article_slug_redirects_oldSlug_key" ON "article_slug_redirects"("oldSlug");
CREATE INDEX IF NOT EXISTS "article_slug_redirects_articleId_idx" ON "article_slug_redirects"("articleId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_slug_redirects_articleId_fkey') THEN
    ALTER TABLE "article_slug_redirects" ADD CONSTRAINT "article_slug_redirects_articleId_fkey"
      FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Same shape the application accepts for an address (src/lib/articleSlug.ts).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_slug_redirects_oldSlug_check') THEN
    ALTER TABLE "article_slug_redirects" ADD CONSTRAINT "article_slug_redirects_oldSlug_check"
      CHECK ("oldSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("oldSlug") <= 120);
  END IF;
END
$$;

-- ── articles: lock the address once public; refuse unauthorised changes and shadowing ───────────────────
CREATE OR REPLACE FUNCTION guard_article_slug() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Once set, never cleared or moved.
    IF OLD."slugLockedAt" IS NOT NULL THEN
      NEW."slugLockedAt" := OLD."slugLockedAt";
    END IF;
    IF NEW.slug IS DISTINCT FROM OLD.slug
       AND (OLD."slugLockedAt" IS NOT NULL OR OLD.status = 'PUBLISHED')
       AND coalesce(current_setting('consilium.article_slug_migration', true), '') <> 'on' THEN
      RAISE EXCEPTION 'ARTICLE_SLUG_LOCKED: the web address of article % is permanent; use the approved slug migration', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'PUBLISHED' AND NEW."slugLockedAt" IS NULL THEN
    NEW."slugLockedAt" := CURRENT_TIMESTAMP;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug)
     AND EXISTS (SELECT 1 FROM article_slug_redirects r WHERE r."oldSlug" = NEW.slug) THEN
    RAISE EXCEPTION 'ARTICLE_SLUG_RETIRED: % is a retired article address and redirects elsewhere', NEW.slug
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS articles_slug_guard ON "articles";
CREATE TRIGGER articles_slug_guard
  BEFORE INSERT OR UPDATE OF slug, status, "slugLockedAt" ON "articles"
  FOR EACH ROW
  EXECUTE FUNCTION guard_article_slug();

-- ── article_slug_redirects: permanent rows that never shadow a live address ────────────────────────────
CREATE OR REPLACE FUNCTION protect_article_slug_redirect() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Depth 2 = the FK cascade from permanently deleting the article (trash purge, account deletion).
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ARTICLE_REDIRECT_PROTECTED: redirect % is permanent', OLD."oldSlug"
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ARTICLE_REDIRECT_PROTECTED: redirect % is permanent', OLD."oldSlug"
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM articles a WHERE a.slug = NEW."oldSlug") THEN
    RAISE EXCEPTION 'ARTICLE_REDIRECT_SHADOWED: % is still the address of an article', NEW."oldSlug"
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS article_slug_redirects_guard ON "article_slug_redirects";
CREATE TRIGGER article_slug_redirects_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "article_slug_redirects"
  FOR EACH ROW
  EXECUTE FUNCTION protect_article_slug_redirect();

-- Not callable through the Data API (same treatment as the other trigger functions, 20261012110000).
REVOKE EXECUTE ON FUNCTION guard_article_slug() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION protect_article_slug_redirect() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_article_slug() FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION protect_article_slug_redirect() FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "article_slug_redirects" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_article_slug() FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION protect_article_slug_redirect() FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "article_slug_redirects" FROM authenticated';
  END IF;
END
$$;

ALTER TABLE "article_slug_redirects" ENABLE ROW LEVEL SECURITY;

-- Backfill: anything that is or was public keeps its address. Re-running changes nothing (only NULLs are set).
UPDATE "articles"
   SET "slugLockedAt" = COALESCE("publishedAt", "hiddenByDebateAt", CURRENT_TIMESTAMP)
 WHERE "slugLockedAt" IS NULL
   AND ("status" = 'PUBLISHED' OR "publishedAt" IS NOT NULL OR "hiddenByDebateAt" IS NOT NULL OR "viewCount" > 0);
