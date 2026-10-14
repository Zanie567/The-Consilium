-- =============================================================================
-- Migration: link Meet the Team cards to accounts (one profile per account)
-- Date: 2026-10-01
-- =============================================================================
--
-- Apply manually in the Supabase SQL editor (prisma migrate is not used against
-- production). Additive and idempotent: no rows are modified or deleted, and the
-- column is nullable so every existing card keeps working unchanged.
--
-- Inspected before writing (read-only, 2026-10-01): 10 team_members rows, none with
-- an email, so no existing card can be linked automatically. They remain legacy
-- cards (userId NULL) until the person creates their profile from the portal,
-- at which point the API adopts a legacy row with a matching email if exactly one
-- exists, instead of creating a duplicate.
--
-- Security: the column is NOT added to the anon column grant in
-- 20260408_restrict_column_grants.sql, so PostgREST cannot read it. RLS on
-- team_members stays as is (anon SELECT only; no insert/update/delete policy), and
-- Prisma (superuser) is the only writer — authorisation lives in the API route.
-- =============================================================================

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- The integrity guarantee: at most one card per account, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_userId_key" ON team_members ("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_userId_fkey'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT "team_members_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES users (id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Storage: the `avatars` bucket
--
-- Inspected 2026-10-01: production has only the `article-images` bucket, so
-- POST /api/upload?bucket=avatars (profile photos) and PUT /api/team-profile
-- would both fail. Created public-read, with the size and type limits repeated at
-- the bucket as defence in depth behind the API's own checks. No storage policies
-- are added: the app writes with the service-role key from the server only, and
-- every path is built from the verified session user (`<userId>/…`).
--
-- Public bucket, deliberately: Meet the Team photos are shown to anonymous visitors
-- through next/image, which fetches the plain public URL. A private bucket would
-- need signed URLs that expire, and the cards would break once they did.
--
-- Review note (not changed here): storage.objects carries "Allow authenticated
-- uploads" (INSERT, role `authenticated`, bucket 'article-images' only) and "Allow
-- public reads" (SELECT, same bucket). This app authenticates with NextAuth and
-- uploads with the service-role key, which bypasses RLS, and production has 0
-- Supabase Auth users — so neither policy is used. The INSERT policy would let
-- anyone able to mint a Supabase Auth JWT write any file type and size to
-- article-images, around the app's own checks. See the rollout notes.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'avatars', 'avatars', true, 5242880,
      ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
