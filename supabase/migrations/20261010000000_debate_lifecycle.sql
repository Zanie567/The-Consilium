-- =============================================================================
-- Migration: debate lifecycle (unpublish, soft delete, restore)
-- Date: 2026-10-10
-- =============================================================================
--
-- Apply manually in the Supabase SQL editor (prisma migrate is not used against
-- production), AFTER reviewing it. Additive and idempotent: re-running is harmless,
-- and every existing debate keeps behaving exactly as today (all three new columns
-- are NULL, which means "published, not deleted").
--
--   unpublishedAt  set  => hidden from every public surface, content retained
--   deletedAt      set  => soft deleted, recoverable by an administrator
--   deletedById    who deleted it (a plain id, so the trail outlives the account)
--
-- Public visibility is: deletedAt IS NULL AND unpublishedAt IS NULL.
-- Nothing is dropped or rewritten. Debate -> Article and DebateVote -> Debate foreign
-- keys are unchanged (votes still cascade only on a deliberate permanent delete).
--
-- Rollback (only if no debate has been unpublished/deleted since, or accept losing
-- that state): ALTER TABLE debates DROP COLUMN "unpublishedAt", DROP COLUMN "deletedAt",
-- DROP COLUMN "deletedById"; DROP INDEX IF EXISTS "debates_deletedAt_unpublishedAt_idx";
-- =============================================================================

ALTER TABLE debates ADD COLUMN IF NOT EXISTS "unpublishedAt" TIMESTAMP(3);
ALTER TABLE debates ADD COLUMN IF NOT EXISTS "deletedAt"     TIMESTAMP(3);
ALTER TABLE debates ADD COLUMN IF NOT EXISTS "deletedById"   TEXT;

CREATE INDEX IF NOT EXISTS "debates_deletedAt_unpublishedAt_idx"
  ON debates ("deletedAt", "unpublishedAt");

-- RLS on debates was enabled by 20260903_enable_rls_remaining_tables.sql with no
-- policies (deny by default for PostgREST); new columns inherit that. Prisma, as
-- the table owner, remains the only writer.
