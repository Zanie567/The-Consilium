-- =============================================================================
-- Migration: remember which articles a debate hid automatically
-- Version:   20261012100000 (unique 14-digit prefix: safe for the Supabase CLI as well as manual use)
-- Requires:  20261010_debate_lifecycle.sql and 20261011_hidden_debate_article_guard.sql
--            (the application code needs them; this file itself only needs the articles table)
-- =============================================================================
--
-- Apply manually after review; additive and idempotent. Existing rows get NULL, which means
-- "not hidden by a debate": nothing changes for any existing article.
--
-- Problem: unpublishing a debate moves its PUBLISHED articles to ARCHIVED, and publishing it moved EVERY
-- ARCHIVED article of the debate back to PUBLISHED, including one an editor had archived on purpose.
-- Nothing recorded why an article was archived.
--
-- Rule:
--   articles."hiddenByDebateAt" IS NOT NULL  <=>  a debate lifecycle action moved this article
--                                                 PUBLISHED -> ARCHIVED, and no editorial action has touched
--                                                 its status or trash state since.
--   * Only the debate lifecycle sets it (the same UPDATE that archives the article).
--   * Debate "publish" restores ONLY ARCHIVED, non-trashed articles that still carry it, and clears it.
--   * Any other change to an article's status or trash state clears it (trigger below), whichever code or
--     SQL made the change, so a deliberate editorial decision always wins and can never be undone later.
--   * An ARCHIVED article without the marker is never restored automatically.
--   * SCHEDULED articles are never touched by the lifecycle (it moves PUBLISHED only). While the debate is
--     hidden the scheduled-publish job is refused for them by articles_hidden_debate_guard and skips them;
--     once the debate is published again the job publishes them when they fall due.
--
-- No backfill, deliberately: articles already archived inside a hidden debate cannot be told apart from
-- deliberately archived ones, so they stay archived and an editor republishes them. (Production has no
-- debate lifecycle columns yet, so it has no hidden debates; hosted staging had none left after verification.)
--
-- Rollback: DROP TRIGGER IF EXISTS articles_clear_hidden_by_debate ON articles;
--           DROP FUNCTION IF EXISTS clear_article_hidden_by_debate();
--           ALTER TABLE articles DROP COLUMN IF EXISTS "hiddenByDebateAt";
--           (loses only the "was archived by a debate" memory; no article, debate or vote is changed)
-- =============================================================================

ALTER TABLE articles ADD COLUMN IF NOT EXISTS "hiddenByDebateAt" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION clear_article_hidden_by_debate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Fires only when the article carries the marker (see WHEN below). If the statement changed the marker
  -- itself, it is the debate lifecycle speaking (hide sets it, show clears it): leave its value alone.
  IF NEW."hiddenByDebateAt" IS NOT DISTINCT FROM OLD."hiddenByDebateAt"
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt") THEN
    NEW."hiddenByDebateAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS articles_clear_hidden_by_debate ON articles;
CREATE TRIGGER articles_clear_hidden_by_debate
  BEFORE UPDATE OF status, "deletedAt" ON articles
  FOR EACH ROW
  WHEN (OLD."hiddenByDebateAt" IS NOT NULL)
  EXECUTE FUNCTION clear_article_hidden_by_debate();
