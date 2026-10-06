-- =============================================================================
-- Migration: member onboarding (pre-authorised memberships) + admin-set team
-- Date: 2026-10-06
-- =============================================================================
--
-- Apply manually in the Supabase SQL editor (prisma migrate is not used against
-- production). Additive and idempotent; re-running is harmless. Nothing is
-- modified or deleted: existing users, roles and team cards keep working.
--
-- 1. team_memberships: one row per email. An admin creates it BEFORE the person has
--    an account; the first verified sign-in with that email claims it. users.role
--    remains the value every access gate reads, so no existing check changes.
-- 2. team_members.team: admin-only public team override ('writing' | 'editorial' |
--    'growth'). NULL keeps today's behaviour (team derived from the account role).
-- 3. Backfill: every existing staff account (role <> READER) gets an ACTIVE
--    membership so the admin member list and audit trail cover current staff too.
--
-- Security: RLS on, no policies (deny-by-default for PostgREST); Prisma, as the
-- superuser, is the only writer. `team` is not added to any anon column grant.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MembershipStatus') THEN
    CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_memberships (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  role             "Role" NOT NULL,
  status           "MembershipStatus" NOT NULL DEFAULT 'PENDING',
  "userId"         TEXT,
  "displayName"    TEXT,
  "publicPosition" TEXT,
  "publicTeam"     TEXT,
  "invitedById"    TEXT,
  "invitedByName"  TEXT,
  "claimedAt"      TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),
  "revokedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_memberships_email_key"  ON team_memberships (email);
CREATE UNIQUE INDEX IF NOT EXISTS "team_memberships_userId_key" ON team_memberships ("userId");
CREATE INDEX IF NOT EXISTS "team_memberships_status_idx"        ON team_memberships (status);

-- Emails are stored lower-cased by the application; enforce it here too so two rows
-- can never differ only by case.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_memberships_email_lower') THEN
    ALTER TABLE team_memberships
      ADD CONSTRAINT team_memberships_email_lower CHECK (email = lower(btrim(email)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_memberships_userId_fkey') THEN
    ALTER TABLE team_memberships
      ADD CONSTRAINT "team_memberships_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS team TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_members_team_check') THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_team_check CHECK (team IS NULL OR team IN ('writing', 'editorial', 'growth'));
  END IF;
END $$;

-- Backfill current staff. Accounts whose lower-cased email would collide are skipped
-- by ON CONFLICT rather than failing the whole migration.
INSERT INTO team_memberships (id, email, role, status, "userId", "claimedAt", "createdAt", "updatedAt")
SELECT 'bf_' || u.id, lower(btrim(u.email)), u.role, 'ACTIVE', u.id, now(), now(), now()
FROM users u
WHERE u.role <> 'READER'
ON CONFLICT DO NOTHING;
