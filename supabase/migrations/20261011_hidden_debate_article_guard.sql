-- =============================================================================
-- Migration: a hidden debate's articles can never be public (database invariant)
-- Date: 2026-10-11
-- Requires: 20261010_debate_lifecycle.sql (debates.unpublishedAt / deletedAt)
-- =============================================================================
--
-- Apply manually after review; idempotent. Every way an article becomes public (the editor,
-- review approval, the scheduled-publish job, trash restore, a script, a hand-run UPDATE) ends
-- in a write to articles.status / articles."deletedAt". This trigger refuses the write when the
-- article belongs to a debate that is unpublished or deleted, so the rule holds for code that
-- exists today, code added later, and concurrent requests.
--
-- Concurrency: the trigger first takes a SHARE lock on the debate row(s). If an administrator is
-- hiding the debate in a transaction that has not committed yet, the lock waits for it and the
-- next statement then sees the committed state. If the publisher locks first, the administrator's
-- hide waits until the publish commits and then archives the article. Either order ends hidden.
--
-- Security: the function runs with its owner's rights (see below) and takes no input beyond NEW.
--
-- Scope: status PUBLISHED or SCHEDULED with "deletedAt" IS NULL. Archiving, drafting, trashing
-- and the debate's own publish/restore flow are unaffected (publishing a debate clears its
-- unpublishedAt first, in the same transaction, then re-publishes its articles).
--
-- Healing: any article that is already public while its debate is hidden is archived (the same
-- thing "Unpublish" does). On a database that has never had a hidden debate this changes nothing.
--
-- Rollback: DROP TRIGGER IF EXISTS articles_hidden_debate_guard ON articles;
--           DROP FUNCTION IF EXISTS prevent_hidden_debate_article_publication();
-- =============================================================================

CREATE OR REPLACE FUNCTION prevent_hidden_debate_article_publication() RETURNS trigger
LANGUAGE plpgsql
-- DEFINER, not invoker: `debates` has row-level security enabled with no policies, so a role that
-- does not bypass RLS would see zero debates and the guard would silently pass. As the owner the
-- function always sees (and may lock) every debate. The search path is pinned so an attacker-
-- controlled schema cannot shadow `debates`.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Lock first (statement 1), judge second (statement 2): the second statement takes a fresh
  -- snapshot, so it sees a concurrent hide that committed while we waited for the lock.
  PERFORM 1 FROM debates d
   WHERE d."forArticleId" = NEW.id OR d."againstArticleId" = NEW.id
   FOR SHARE;

  IF EXISTS (
    SELECT 1 FROM debates d
     WHERE (d."forArticleId" = NEW.id OR d."againstArticleId" = NEW.id)
       AND (d."deletedAt" IS NOT NULL OR d."unpublishedAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'HIDDEN_DEBATE_ARTICLE: article % belongs to an unpublished or deleted debate and cannot be made public', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS articles_hidden_debate_guard ON articles;
CREATE TRIGGER articles_hidden_debate_guard
  BEFORE INSERT OR UPDATE OF status, "deletedAt" ON articles
  FOR EACH ROW
  WHEN (NEW.status IN ('PUBLISHED', 'SCHEDULED') AND NEW."deletedAt" IS NULL)
  EXECUTE FUNCTION prevent_hidden_debate_article_publication();

-- Heal existing exposure (idempotent). The trigger does not fire for ARCHIVED.
UPDATE articles a
   SET status = 'ARCHIVED'
 WHERE a.status IN ('PUBLISHED', 'SCHEDULED')
   AND a."deletedAt" IS NULL
   AND EXISTS (
     SELECT 1 FROM debates d
      WHERE (d."forArticleId" = a.id OR d."againstArticleId" = a.id)
        AND (d."deletedAt" IS NOT NULL OR d."unpublishedAt" IS NOT NULL)
   );
