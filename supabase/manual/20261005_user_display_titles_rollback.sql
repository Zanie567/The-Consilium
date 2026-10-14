-- =============================================================================
-- Rollback for 20261005_user_display_titles.sql
-- =============================================================================
-- Idempotent. DESTRUCTIVE for the column: any display titles already set are lost.
-- Roll back the app deploy first, or the new code will query a missing column.
--
-- The REVOKE and RESTRICTIVE policy are intentionally NOT undone below: anon and
-- authenticated held no privileges on users before this migration either, so
-- leaving them in place restores the original effective state. To remove the
-- policy anyway, uncomment the last statement.

BEGIN;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS "users_displayTitles_valid";
ALTER TABLE public.users DROP COLUMN IF EXISTS "displayTitles";
DROP FUNCTION IF EXISTS public.users_display_titles_valid(text[]);

-- DROP POLICY IF EXISTS "users_no_client_writes" ON public.users;

COMMIT;
