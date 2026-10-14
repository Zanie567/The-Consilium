-- =============================================================================
-- Migration: Enable Row-Level Security on the tables added after 20260408
-- Date: 2026-09-03
-- =============================================================================
--
-- WHY THIS EXISTS:
--
-- 20260408_enable_rls.sql enabled RLS on the 20 tables that existed at the time.
-- The 14 tables below were added afterwards and had RLS turned on directly on
-- the project rather than through a tracked migration. Production is therefore
-- already correct — this migration does not change the live security posture.
-- It exists so the repository, not the dashboard, is the source of truth: an
-- environment rebuilt from these migrations alone would otherwise come up with
-- RLS disabled on every table listed here.
--
-- Verified against the project before writing this file:
--   * all tables in `public` report relrowsecurity = true (36 as of 2026-09-10)
--   * no table-level grants to anon/authenticated exist
--   * column-level SELECT grants for anon exist only on the 6 public-content
--     tables allowlisted in 20260408_restrict_column_grants.sql
--
-- ACCESS MODEL (unchanged, see 20260408_enable_rls.sql for the full notes):
--   Prisma connects as the postgres superuser and bypasses RLS entirely, so no
--   application query or API route is affected by this migration. RLS here is
--   defence-in-depth for the PostgREST surface, which reaches these tables as
--   the `anon` role.
--
-- No policies are created: RLS enabled with no policy is deny-by-default, which
-- is the intended posture for every table below. None of them holds publicly
-- readable content, and none is read through PostgREST by this application.
--
-- Re-running this file is harmless; ENABLE ROW LEVEL SECURITY on a table that
-- already has it is a no-op.
-- =============================================================================

-- Editorial / moderation records
ALTER TABLE admin_notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_warnings        ENABLE ROW LEVEL SECURITY;

-- Reader-facing discussion (served to the browser through the app's own API
-- routes, which apply their own authorization — never read via PostgREST)
ALTER TABLE comments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_upvotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE debates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE debate_votes         ENABLE ROW LEVEL SECURITY;

-- Predictions league
ALTER TABLE prediction_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions          ENABLE ROW LEVEL SECURITY;

-- Gamification
ALTER TABLE writer_achievements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE writer_streaks       ENABLE ROW LEVEL SECURITY;
-- Prisma created this model without an @@map, so the table name is camel-cased
-- and must be quoted.
ALTER TABLE "ArticleTrophy"      ENABLE ROW LEVEL SECURITY;

-- Site configuration and analytics
ALTER TABLE site_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_views           ENABLE ROW LEVEL SECURITY;

-- Added after this file was first drafted. Both already report
-- relrowsecurity = true on the project; listed here so a rebuild from these
-- migrations alone reaches the same posture as production.
ALTER TABLE glossary_terms       ENABLE ROW LEVEL SECURITY;

-- `article_translations` exists on the project but has no Prisma model yet (it
-- belongs to unmerged translation work), so `prisma db push` does NOT create it
-- on a fresh database. A bare ALTER would abort this file during a rebuild.
-- Guarded so it hardens the table where it exists and is a no-op where it does
-- not; when the model lands, move this up with the others.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'article_translations'
      AND relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER TABLE article_translations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;


-- =============================================================================
-- Verification query (run manually after applying)
-- =============================================================================
--
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
--     AND relrowsecurity = false;
--
-- Expected: (0 rows)
