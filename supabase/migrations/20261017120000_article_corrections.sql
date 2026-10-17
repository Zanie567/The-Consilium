-- =============================================================================
-- Migration: post-publication corrections record (article_corrections)
-- Version:   20261017120000 (unique 14-digit prefix: safe for the Supabase CLI and for manual use)
-- Requires:  articles (any version)
-- =============================================================================
--
-- Additive and idempotent. Apply manually after review, in ONE transaction, following
-- docs/corrections/PRODUCTION-RUNBOOK.md. Never `supabase db push` (it would also try every other
-- unrecorded file). Nothing existing is altered or dropped: articles.corrected and
-- articles."correctionNote" stay exactly as they are.
--
-- What it adds
--   * enums "CorrectionType" (CORRECTION | CLARIFICATION | UPDATE) and "CorrectionStatus" (PENDING |
--     PUBLISHED | WITHDRAWN);
--   * table article_corrections: one row per correction, clarification or update notice, with the
--     public note, the internal working record, the before/after text snapshots and who prepared and
--     approved it. Column, index and constraint names are exactly those Prisma generates for
--     model ArticleCorrection, so a `prisma db push` database and a migrated one are identical;
--   * CHECK constraints that make an inconsistent row impossible (a published, non-legacy row always
--     has a public note, a publication time, an approver and its text snapshots);
--   * at most one PENDING correction per article, and at most one non-withdrawn amendment per notice
--     (partial unique indexes);
--   * trigger article_corrections_protect: PUBLISHED and WITHDRAWN rows are permanent (no UPDATE), and no
--     row can be deleted directly. The only deletion allowed is the cascade when the article itself is
--     permanently deleted (trash purge, "delete permanently", account deletion); each published notice removed
--     that way is first copied into audit_logs ('correction.removed_with_article') so its public text survives;
--   * RLS on, no grants to anon/authenticated (the app connects as the table owner, as for every table);
--   * a backfill of legacy single-note corrections (articles.corrected = true) as PUBLISHED rows with
--     legacy = true and "publishedAt" NULL, because the real correction date was never stored and must
--     not be invented. Re-running inserts nothing for an article that already has any correction row.
--
-- Rollback (only while no new correction has been published; it discards the corrections record):
--   supabase/manual/20261017120000_article_corrections_rollback.sql
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CorrectionType' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "CorrectionType" AS ENUM ('CORRECTION', 'CLARIFICATION', 'UPDATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CorrectionStatus' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'PUBLISHED', 'WITHDRAWN');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "article_corrections" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" "CorrectionType" NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "publicNote" TEXT,
    "originalText" TEXT,
    "correctedText" TEXT,
    "internalNote" TEXT,
    "baseVersion" TEXT,
    "proposed" JSONB,
    "previous" JSONB,
    "supersedesId" TEXT,
    "requestKey" TEXT,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "withdrawnById" TEXT,
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),

    CONSTRAINT "article_corrections_pkey" PRIMARY KEY ("id")
);

-- A published notice has at most one live amendment; a withdrawn amendment does not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS "article_corrections_one_amendment_per_notice" ON "article_corrections"("supersedesId") WHERE "status" <> 'WITHDRAWN';
CREATE UNIQUE INDEX IF NOT EXISTS "article_corrections_requestKey_key" ON "article_corrections"("requestKey");
CREATE INDEX IF NOT EXISTS "article_corrections_articleId_status_publishedAt_idx" ON "article_corrections"("articleId", "status", "publishedAt");
-- Two editors cannot both have a correction awaiting approval on the same article.
CREATE UNIQUE INDEX IF NOT EXISTS "article_corrections_one_pending_per_article" ON "article_corrections"("articleId") WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_corrections_articleId_fkey') THEN
    ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_articleId_fkey"
      FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_corrections_supersedesId_fkey') THEN
    ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_supersedesId_fkey"
      FOREIGN KEY ("supersedesId") REFERENCES "article_corrections"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  -- A non-legacy row always names who prepared it, carries a public note and knows which article
  -- version it was prepared against, with the text it proposes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_corrections_prepared_check') THEN
    ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_prepared_check" CHECK (
      "legacy" OR (
        "createdById" IS NOT NULL
        AND "publicNote" IS NOT NULL AND char_length(btrim("publicNote")) BETWEEN 1 AND 2000
        AND "baseVersion" IS NOT NULL
        AND "proposed" IS NOT NULL
        AND "requestKey" IS NOT NULL
      )
    );
  END IF;
  -- Published means: a publication time, an approver and the before-text snapshot (non-legacy rows).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_corrections_published_check') THEN
    ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_published_check" CHECK (
      "status" <> 'PUBLISHED' OR "legacy" OR (
        "publishedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "previous" IS NOT NULL
      )
    );
  END IF;
  -- Only a published row has a publication time; a legacy row is always a published correction.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'article_corrections_state_check') THEN
    ALTER TABLE "article_corrections" ADD CONSTRAINT "article_corrections_state_check" CHECK (
      ("status" = 'PUBLISHED' OR "publishedAt" IS NULL)
      AND ("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL)
      AND (NOT "legacy" OR ("status" = 'PUBLISHED' AND "type" = 'CORRECTION'))
      AND ("supersedesId" IS NULL OR "supersedesId" <> "id")
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION protect_article_correction() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Inside the FK cascade from deleting the article the nesting depth is 2 (the RI trigger on
    -- articles runs this DELETE). A direct DELETE runs at depth 1 and is refused.
    IF pg_trigger_depth() > 1 THEN
      -- The article itself is being permanently deleted (trash purge, "delete permanently", account deletion).
      -- The site stops showing its notices, but what was said publicly is kept in the internal audit log.
      IF OLD."status" = 'PUBLISHED' THEN
        INSERT INTO audit_logs ("id", "action", "targetId", "targetType", "performedBy", "metadata", "createdAt")
        VALUES (
          'corr_del_' || OLD.id || '_' || md5(clock_timestamp()::text),
          'correction.removed_with_article', OLD."articleId", 'article', 'system:article-deletion',
          jsonb_build_object(
            'correctionId', OLD.id, 'type', OLD."type", 'publicNote', OLD."publicNote",
            'publishedAt', OLD."publishedAt", 'legacy', OLD."legacy", 'approvedByName', OLD."approvedByName",
            'supersedesId', OLD."supersedesId"
          ),
          CURRENT_TIMESTAMP
        );
      END IF;
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'CORRECTION_RECORD_PROTECTED: correction % cannot be deleted; withdraw a pending correction instead', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'CORRECTION_RECORD_PROTECTED: correction % is % and permanent; publish an amendment instead', OLD.id, OLD."status"
      USING ERRCODE = '23514';
  END IF;
  -- A pending row may be revised, published or withdrawn, but never moved to another article,
  -- re-attributed or turned into a legacy record.
  IF NEW."articleId" IS DISTINCT FROM OLD."articleId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
     OR NEW."legacy" IS DISTINCT FROM OLD."legacy" THEN
    RAISE EXCEPTION 'CORRECTION_RECORD_PROTECTED: the identity of correction % cannot be changed', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS article_corrections_protect ON "article_corrections";
CREATE TRIGGER article_corrections_protect
  BEFORE UPDATE OR DELETE ON "article_corrections"
  FOR EACH ROW
  EXECUTE FUNCTION protect_article_correction();

-- Not callable through the Data API (same treatment as the other trigger functions, 20261012110000).
REVOKE EXECUTE ON FUNCTION protect_article_correction() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION protect_article_correction() FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "article_corrections" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION protect_article_correction() FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "article_corrections" FROM authenticated';
  END IF;
END
$$;

ALTER TABLE "article_corrections" ENABLE ROW LEVEL SECURITY;

-- Legacy backfill. "publishedAt" stays NULL: the old fields never recorded when a correction was made,
-- and articles."updatedAt" changes on every later edit, so it is not evidence of the correction date.
INSERT INTO "article_corrections" ("id", "articleId", "type", "status", "publicNote", "legacy", "createdAt", "updatedAt")
SELECT 'legacy_' || a."id", a."id", 'CORRECTION', 'PUBLISHED', NULLIF(btrim(a."correctionNote"), ''), true,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "articles" a
WHERE a."corrected" = true
  AND NOT EXISTS (SELECT 1 FROM "article_corrections" c WHERE c."articleId" = a."id");

COMMENT ON TABLE "article_corrections" IS
  'Post-publication corrections, clarifications and update notices. PUBLISHED/WITHDRAWN rows are permanent (trigger article_corrections_protect). See docs/corrections/.';
COMMENT ON COLUMN "article_corrections"."publishedAt" IS
  'Server time the notice became public. NULL for legacy rows: the original correction date was never recorded.';
