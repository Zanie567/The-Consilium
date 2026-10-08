-- ROLLBACK for the four PR #117 migrations. Review before use; never run it unattended.
--
--   20261006153514_discovery_topic_identity      20261006160355_managed_article_images
--   20261006161413_normalized_subscriber_email   20261006161505_article_active_engagement
--
-- What this does: removes everything the four migrations added, in reverse order, and puts
-- article_tags_tagId_fkey back to ON DELETE CASCADE as it was before. It touches no row in any
-- pre-existing table. It is tested (tests/integration/pr117-migrations-rehearsal.test.ts): applying
-- the four migrations then this file returns the catalog to its pre-#117 state, and the four can be
-- applied again afterwards.
--
-- WHAT IT DOES NOT UNDO: the deployed CODE. The code at ec2a4d5 calls public.consilium_tag_identity()
-- and public.consilium_subscriber_identity(). Rolling the database back WITHOUT rolling the code back
-- returns production to the state that exists today: newsletter sign-ups and any article save that
-- carries tags fail with "function ... does not exist". Roll the database back only if a migration
-- itself misbehaves; otherwise prefer rolling forward. To undo #117 fully, redeploy the previous
-- production deployment (31a2053) as well.
--
-- DATA SAFETY: the two tables below are dropped. If either holds rows, this refuses to run, because
-- the rows would be lost. Dump them first (see the plan), then run with:
--     psql ... -v force=yes -f pr117-rollback.sql
-- or, in the SQL editor, first run:  select set_config('pr117.rollback_force', 'yes', false);

BEGIN;

DO $$
DECLARE
  v_images bigint := 0;
  v_sessions bigint := 0;
BEGIN
  IF to_regclass('public.article_image_assets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.article_image_assets' INTO v_images;
  END IF;
  IF to_regclass('public.article_engagement_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.article_engagement_sessions' INTO v_sessions;
  END IF;
  IF (v_images > 0 OR v_sessions > 0) AND coalesce(current_setting('pr117.rollback_force', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing to roll back: article_image_assets has % row(s) and article_engagement_sessions has % row(s). Dump them first, then set pr117.rollback_force = yes.', v_images, v_sessions;
  END IF;
END $$;

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

COMMIT;
