-- =============================================================================
-- Migration: team_members.updatedAt (stale-edit protection for administrators)
-- Date: 2026-10-10
-- =============================================================================
--
-- Apply manually in the Supabase SQL editor after review. Additive and idempotent.
-- Existing rows get the time of the migration; nothing else changes. Prisma maintains
-- the value on every later update (@updatedAt), and the admin Team Members screen sends
-- the value it loaded so an edit made from a stale form is refused instead of
-- silently overwriting a newer change.
--
-- Uniqueness is NOT changed here: team_members.userId is already UNIQUE (one card per
-- account), and team_memberships.userId/email are already UNIQUE.
--
-- Rollback: ALTER TABLE team_members DROP COLUMN IF EXISTS "updatedAt";
-- =============================================================================

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
