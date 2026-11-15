-- Rollback for supabase/migrations/20261115120000_tag_taxonomy.sql
--
-- Deploy the previous application version FIRST (the new code reads these objects), then run this
-- in one transaction.
--
-- What is lost: aliases, suggestions, tag descriptions, and the retired/merged markers. Article links
-- are NOT touched: an article moved to another tag by a merge stays on that tag. To put merged
-- articles back first, use "Undo merge" in /editorial/tags (it restores the links recorded in the
-- audit log) before rolling back.
--
-- Copy first if anything is there:
--   SELECT * FROM tag_aliases;  SELECT * FROM tag_suggestions;
--   SELECT id, name, slug, description, "retiredAt", "mergedIntoId" FROM tags
--    WHERE description IS NOT NULL OR "retiredAt" IS NOT NULL OR "mergedIntoId" IS NOT NULL;
BEGIN;
DROP TRIGGER IF EXISTS tags_alias_guard ON "tags";
DROP FUNCTION IF EXISTS guard_tag_name_against_aliases();
DROP TABLE IF EXISTS "tag_suggestions";
DROP TYPE IF EXISTS "TagSuggestionStatus";
DROP TABLE IF EXISTS "tag_aliases";
DROP FUNCTION IF EXISTS guard_tag_alias();
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_merge_check";
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_description_check";
ALTER TABLE "tags" DROP CONSTRAINT IF EXISTS "tags_mergedIntoId_fkey";
DROP INDEX IF EXISTS "tags_mergedIntoId_idx";
ALTER TABLE "tags" DROP COLUMN IF EXISTS "mergedIntoId";
ALTER TABLE "tags" DROP COLUMN IF EXISTS "retiredAt";
ALTER TABLE "tags" DROP COLUMN IF EXISTS "description";
COMMIT;
