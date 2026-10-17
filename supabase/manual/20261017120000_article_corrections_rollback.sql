-- =============================================================================
-- ROLLBACK for supabase/migrations/20261017120000_article_corrections.sql — manual use only.
-- =============================================================================
--
-- Run ONLY after the application code that uses article_corrections has been rolled back (the old
-- code never reads the table), and only after exporting the table if any non-legacy row exists:
--
--   SELECT count(*) FILTER (WHERE NOT legacy) AS issued_in_app, count(*) AS total FROM article_corrections;
--   -- issued_in_app > 0  =>  STOP. Those are real public correction records. Export them first:
--   --   \copy (SELECT * FROM article_corrections ORDER BY "createdAt") TO 'article_corrections.csv' CSV HEADER
--   -- and get the Editor-in-Chief's explicit approval before discarding them.
--
-- articles.corrected / articles."correctionNote" are untouched by the forward migration, and the
-- application mirrors every published CORRECTION into them, so the older build still shows a notice
-- for corrected articles after this rollback.
--
-- Run in one transaction:
BEGIN;
DROP TRIGGER IF EXISTS article_corrections_protect ON article_corrections;
DROP FUNCTION IF EXISTS protect_article_correction();
DROP TABLE IF EXISTS article_corrections;
DROP TYPE IF EXISTS "CorrectionStatus";
DROP TYPE IF EXISTS "CorrectionType";
COMMIT;
