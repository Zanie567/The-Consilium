-- ############################################################################################
-- # HISTORICAL RECOVERY TOOL. DO NOT RUN AGAINST PRODUCTION.                                  #
-- ############################################################################################
--
-- This script removes everything the four PR #117 migrations added:
--
--   20261006153514_discovery_topic_identity      20261006160355_managed_article_images
--   20261006161413_normalized_subscriber_email   20261006161505_article_active_engagement
--
-- It was written on 2026-10-08, when production had NONE of these objects and the plan was to be able
-- to undo them. The migrations were applied to production on 2026-10-09 and the deployed application
-- (commit 5c14066 and later) now DEPENDS on every object this script drops. Running it against production
-- today would:
--
--   * break newsletter sign-up for every visitor (drops consilium_subscriber_identity and the unique index);
--   * break every article save that carries tags (drops consilium_tag_identity and its unique index);
--   * break image upload and its cleanup (drops article_image_assets: the table that tracks managed images,
--     so uploaded files would become untracked orphans in Storage);
--   * break reading analytics and the two daily crons (drops article_engagement_sessions);
--   * silently re-enable ON DELETE CASCADE from tags to article_tags, so deleting a tag would quietly strip it
--     from every article;
--   * DESTROY DATA as soon as either dropped table holds rows (a separate row-count guard below refuses
--     that unless it is forced as well).
--
-- It does NOT undo deployed code, and a database rollback is almost never the right recovery: if a
-- migrated object misbehaves, prefer a forward-fix migration, or restore from the verified 2026-10-09
-- backup into a NEW project/branch and compare. Treat this file as documentation of what the
-- migrations added, and as a scratch-database tool. It is exercised by the rehearsal test against
-- disposable local databases only.
--
-- GUARD: the whole script is ONE statement (a single DO block), so the guard and the drops succeed or fail
-- together whatever executes it: psql with or without ON_ERROR_STOP, the Supabase SQL editor, or a client
-- that sends statements one at a time. (An earlier version used BEGIN ... COMMIT around separate
-- statements; a client that ran them separately and ignored errors could skip the guard and still run the
-- drops. That was tested and is why this is now one statement.)
-- It refuses to run at all unless the session has first set, in the same session:
--     select set_config('pr117.rollback_acknowledged', 'I-ACCEPT-PRODUCTION-BREAKAGE', false);
-- Even then, it refuses if either dropped table holds rows, unless pr117.rollback_force = 'yes'.
-- Do not set either value against a database that serves real traffic.
--
-- Original description of the mechanics follows.
--
-- What this does: removes everything the four migrations added, in reverse order, and puts
-- article_tags_tagId_fkey back to ON DELETE CASCADE as it was before. It touches no row in any
-- pre-existing table. It is tested (tests/integration/pr117-migrations-rehearsal.test.ts): applying
-- the four migrations then this file returns the catalog to its pre-#117 state, and the four can be
-- applied again afterwards.

DO $$
DECLARE
  v_images bigint := 0;
  v_sessions bigint := 0;
BEGIN
  IF coalesce(current_setting('pr117.rollback_acknowledged', true), '') <> 'I-ACCEPT-PRODUCTION-BREAKAGE' THEN
    RAISE EXCEPTION 'Refusing to run: this is a historical script that would break the deployed application (sign-up, tagged saves, image upload, analytics). Production has had the PR #117 migrations since 2026-10-09. See docs/remediation/pr117-database-migrations.md section 10.';
  END IF;
  IF to_regclass('public.article_image_assets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.article_image_assets' INTO v_images;
  END IF;
  IF to_regclass('public.article_engagement_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.article_engagement_sessions' INTO v_sessions;
  END IF;
  IF (v_images > 0 OR v_sessions > 0) AND coalesce(current_setting('pr117.rollback_force', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing to roll back: article_image_assets has % row(s) and article_engagement_sessions has % row(s). Dump them first, then set pr117.rollback_force = yes.', v_images, v_sessions;
  END IF;

-- 4. article_active_engagement
DROP TABLE IF EXISTS public.article_engagement_sessions;

-- 3. normalized_subscriber_email
DROP INDEX IF EXISTS public.subscribers_normalized_email_key;
DROP FUNCTION IF EXISTS public.consilium_subscriber_identity(text);

-- 2. managed_article_images
DROP TABLE IF EXISTS public.article_image_assets;

-- 1. discovery_topic_identity (the foreign key goes back to ON DELETE CASCADE, exactly as before)
ALTER TABLE public.article_tags DROP CONSTRAINT IF EXISTS "article_tags_tagId_fkey";
ALTER TABLE public.article_tags
  ADD CONSTRAINT "article_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES public.tags(id) ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS public."article_tags_tagId_articleId_idx";
DROP INDEX IF EXISTS public.tags_canonical_identity_key;
DROP FUNCTION IF EXISTS public.consilium_tag_identity(text);

END $$;
