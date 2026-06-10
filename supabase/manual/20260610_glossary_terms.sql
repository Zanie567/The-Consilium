-- ACTION REQUIRED: Run this SQL manually in the Supabase SQL editor before
-- deploying the glossary feature. Until it is applied, glossary reads fail and
-- the article page silently renders without term links (the failure is caught).
--
-- Creates the economics glossary table backing hover tooltips in article
-- bodies. Mirrors the GlossaryTerm model in prisma/schema.prisma.
--
-- Notes:
--   * Column names are camelCase quoted identifiers because the Prisma model
--     does not use @map on fields (matches how prisma db push would create it).
--   * The lower(term) unique index is what makes term uniqueness
--     case-insensitive in practice; the plain unique index on term mirrors the
--     Prisma @unique attribute.
--   * RLS is enabled with no policies (deny-by-default for the anon role),
--     matching every other table; the app connects as the postgres user, which
--     bypasses RLS.
--   * No site_settings row is inserted: a missing glossary_linking_enabled key
--     means the feature is OFF, so this deploys dark by default.

CREATE TABLE IF NOT EXISTS "glossary_terms" (
  "id"           TEXT PRIMARY KEY,
  "term"         TEXT NOT NULL,
  "aliases"      TEXT[] NOT NULL DEFAULT '{}',
  "definition"   TEXT NOT NULL,
  "learnMoreUrl" TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "glossary_terms_term_key"
  ON "glossary_terms"("term");

CREATE UNIQUE INDEX IF NOT EXISTS "glossary_terms_term_lower_key"
  ON "glossary_terms"(lower("term"));

CREATE INDEX IF NOT EXISTS "glossary_terms_isActive_idx"
  ON "glossary_terms"("isActive");

ALTER TABLE "glossary_terms" ENABLE ROW LEVEL SECURITY;
