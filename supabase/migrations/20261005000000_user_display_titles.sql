-- =============================================================================
-- Migration: display titles on users
-- Date: 2026-10-05
-- =============================================================================
--
-- Apply manually in the Supabase SQL editor (prisma migrate is not used against
-- production). Touches ONLY the users table. Fully idempotent. Independent of the
-- unapplied appointments migration (20261003231314): it references no
-- team_members column.
--
-- What this adds
--   users."displayTitles" text[]: public-facing titles, separate from the
--   permission role. Labels only. Nothing in the app grants access from it.
--   Rules, enforced by the database as a last line of defence:
--     - every entry is one of the allowed titles
--     - no duplicates
--     - at most 4 entries
--   Existing rows get '{}' and keep displaying their current label (the app falls
--   back: displayTitles, then team card title, then permission-role label).
--
-- Changing the allowed list later: replace the function body below with
-- CREATE OR REPLACE FUNCTION (the CHECK constraint calls it, so it need not be
-- recreated), and update src/lib/displayTitles.ts to match.
--
-- SECURITY: where enforcement really lives
--   This app authenticates with NextAuth and talks to Postgres as the superuser
--   through Prisma, which bypasses RLS. auth.uid() is never populated, so a
--   "users may update only their own row" policy cannot be expressed here. Real
--   enforcement is in the API: the caller's id comes from the session, fields are
--   an explicit allowlist, and only ADMIN may write displayTitles. The statements
--   below are defence in depth for the PostgREST roles (anon, authenticated):
--   they can neither write users nor see this column.
--
--   Checked before writing this (read-only, 2026-10-05): anon and authenticated
--   hold no privileges on users, and the only Supabase-client code in the repo
--   (src/app/api/upload/route.ts, src/lib/teamPhotoStorage.ts) uses .storage
--   only. Nothing writes users through the Supabase client, so the REVOKE below
--   changes no behaviour.
--
-- Follow-up, deliberately NOT changed here: storage.objects policy
-- "Allow authenticated uploads qt2lnz_0" (INSERT, role authenticated, bucket
-- article-images) bypasses the app's file type and size checks for anyone able to
-- mint a Supabase Auth JWT. Review separately.
-- =============================================================================

BEGIN;

-- 1. Validation function (CHECK constraints cannot contain subqueries, so the
--    de-duplication test lives in an IMMUTABLE function).
CREATE OR REPLACE FUNCTION public.users_display_titles_valid(titles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    titles IS NOT NULL
    AND cardinality(titles) <= 4
    AND titles <@ ARRAY[
      'Editor-in-Chief',
      'Deputy Editor-in-Chief',
      'Editor',
      'Writer',
      'Senior Editor',
      'Junior Editor',
      'Growth & Communications'
    ]::text[]
    AND cardinality(titles) = (SELECT count(DISTINCT t) FROM unnest(titles) AS t)
$$;

-- 2. The column. Additive: existing rows get an empty array.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "displayTitles" text[] NOT NULL DEFAULT '{}'::text[];

-- 3. The constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_displayTitles_valid' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT "users_displayTitles_valid"
      CHECK (public.users_display_titles_valid("displayTitles"));
  END IF;
END $$;

-- 4. Defence in depth for the PostgREST roles.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.users FROM authenticated;

-- A RESTRICTIVE policy is ANDed with every permissive policy, so even if someone
-- later adds a permissive policy by mistake, anon and authenticated still cannot
-- write users. service_role and postgres bypass RLS and are unaffected.
DROP POLICY IF EXISTS "users_no_client_writes" ON public.users;
CREATE POLICY "users_no_client_writes"
  ON public.users
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification (run after applying)
-- -----------------------------------------------------------------------------
--   SELECT count(*) FILTER (WHERE "displayTitles" = '{}') AS untitled, count(*) AS total FROM users;
--   -- expect untitled = total
--
--   -- Constraint rejects bad values (each should fail with a check violation):
--   --   UPDATE users SET "displayTitles" = ARRAY['Chief Wizard'] WHERE false;  -- (no-op: WHERE false)
--   -- To test for real, use a transaction you roll back:
--   --   BEGIN; UPDATE users SET "displayTitles" = ARRAY['Writer','Writer'] WHERE id = (SELECT id FROM users LIMIT 1); ROLLBACK;
--
--   SELECT policyname, permissive, roles, cmd FROM pg_policies WHERE tablename = 'users';
