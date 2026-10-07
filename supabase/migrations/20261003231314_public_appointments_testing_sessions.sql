-- Reviewed additive migration. Apply only after checking the target schema.
-- Preserves IDs, ownership, media, descriptions, appointments and article links.
BEGIN;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS "publicTier" text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "testPersonaKey" text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "testingRevision" integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "users_testPersonaKey_key" ON users ("testPersonaKey");
CREATE TABLE IF NOT EXISTS testing_sessions (
  id text PRIMARY KEY,
  "tokenHash" text NOT NULL UNIQUE,
  "administratorId" text NOT NULL,
  "personaId" text NOT NULL,
  revision integer NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" timestamp(3) NOT NULL,
  "stoppedAt" timestamp(3),
  "stopReason" text
);
CREATE INDEX IF NOT EXISTS "testing_sessions_administratorId_stoppedAt_idx" ON testing_sessions ("administratorId", "stoppedAt");
-- No anonymous PostgREST exposure to capabilities or test identity.
ALTER TABLE testing_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON testing_sessions FROM anon;
    REVOKE SELECT ("testPersonaKey", "testingRevision") ON users FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON testing_sessions FROM authenticated;
    REVOKE SELECT ("testPersonaKey", "testingRevision") ON users FROM authenticated;
  END IF;
END $$;
COMMIT;
