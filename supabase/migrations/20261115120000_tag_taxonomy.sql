-- =============================================================================
-- Migration: centrally managed tag taxonomy
-- Version:   20261115120000 (unique 14-digit prefix: safe for the Supabase CLI and for manual use)
-- Requires:  20261006153514_discovery_topic_identity.sql (public.consilium_tag_identity)
-- =============================================================================
--
-- Additive and idempotent. Apply manually after review, in ONE transaction, BEFORE deploying the code
-- that uses it (the new code reads these objects; the currently deployed code ignores them). Never
-- `supabase db push`. Runbook: docs/tags/tag-taxonomy.md.
--
-- What it adds
--   * tags.description, tags."retiredAt", tags."mergedIntoId": a retired tag is no longer offered to
--     editors (its page keeps working); a merged tag is retired and names the tag its articles moved to
--     (its page redirects there). No existing tag, slug or article link is changed by this file.
--   * table tag_aliases: other names that find a tag. "identity" is kept equal to
--     consilium_tag_identity(name) by a trigger and is unique, and no alias may share its identity with a
--     tag (nor a tag with an alias), so one wording can only ever mean one tag.
--   * table tag_suggestions: tags proposed by staff who may not create them, awaiting review.
--   * RLS on, no grants to anon/authenticated (the app connects as the table owner, as for every table).
--
-- No row is inserted, updated or deleted by this file.
--
-- Rollback (drops the aliases, suggestions and merge/retire markers; take a copy first if any exist):
--   supabase/manual/20261115120000_tag_taxonomy_rollback.sql
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.consilium_tag_identity(text)') IS NULL THEN
    RAISE EXCEPTION 'tag taxonomy: apply 20261006153514_discovery_topic_identity.sql first';
  END IF;
END
$$;

-- ── tags: description, retirement and merge markers ──────────────────────────────────────────────────
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMPTZ(3);
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
CREATE INDEX IF NOT EXISTS "tags_mergedIntoId_idx" ON "tags"("mergedIntoId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_mergedIntoId_fkey') THEN
    ALTER TABLE "tags" ADD CONSTRAINT "tags_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- A merged tag is always retired, and never merged into itself.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_merge_check') THEN
    ALTER TABLE "tags" ADD CONSTRAINT "tags_merge_check"
      CHECK ("mergedIntoId" IS NULL OR ("mergedIntoId" <> "id" AND "retiredAt" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_description_check') THEN
    ALTER TABLE "tags" ADD CONSTRAINT "tags_description_check"
      CHECK ("description" IS NULL OR char_length("description") <= 500);
  END IF;
END
$$;

-- ── tag_aliases ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tag_aliases" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "tag_aliases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tag_aliases_identity_key" ON "tag_aliases"("identity");
CREATE INDEX IF NOT EXISTS "tag_aliases_tagId_idx" ON "tag_aliases"("tagId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_aliases_tagId_fkey') THEN
    ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_aliases_name_check') THEN
    ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_name_check"
      CHECK (char_length("name") BETWEEN 1 AND 80 AND "identity" <> '');
  END IF;
END
$$;

-- The identity is derived, never trusted from the client, and one wording names one tag only.
CREATE OR REPLACE FUNCTION guard_tag_alias() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."identity" := public.consilium_tag_identity(NEW."name");
  IF EXISTS (SELECT 1 FROM tags t WHERE public.consilium_tag_identity(t.name) = NEW."identity") THEN
    RAISE EXCEPTION 'TAG_ALIAS_CONFLICT: "%" is already the name of a tag', NEW."name"
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tag_aliases_guard ON "tag_aliases";
CREATE TRIGGER tag_aliases_guard
  BEFORE INSERT OR UPDATE OF "name", "identity" ON "tag_aliases"
  FOR EACH ROW
  EXECUTE FUNCTION guard_tag_alias();

-- And the other way round: a tag cannot be created or renamed onto an existing alias.
CREATE OR REPLACE FUNCTION guard_tag_name_against_aliases() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tag_aliases a WHERE a."identity" = public.consilium_tag_identity(NEW.name)) THEN
    RAISE EXCEPTION 'TAG_ALIAS_CONFLICT: "%" is already another name for a tag', NEW.name
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tags_alias_guard ON "tags";
CREATE TRIGGER tags_alias_guard
  BEFORE INSERT OR UPDATE OF "name" ON "tags"
  FOR EACH ROW
  EXECUTE FUNCTION guard_tag_name_against_aliases();

-- ── tag_suggestions ──────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TagSuggestionStatus') THEN
    CREATE TYPE "TagSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'MERGED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "tag_suggestions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "note" TEXT,
    "status" "TagSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "articleId" TEXT,
    "suggestedById" TEXT NOT NULL,
    "resolvedTagId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tag_suggestions_status_createdAt_idx" ON "tag_suggestions"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "tag_suggestions_identity_idx" ON "tag_suggestions"("identity");
-- One open suggestion per wording per person: suggesting it again is not a second request.
CREATE UNIQUE INDEX IF NOT EXISTS "tag_suggestions_pending_once" ON "tag_suggestions"("identity", "suggestedById")
  WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_suggestions_articleId_fkey') THEN
    ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_articleId_fkey"
      FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_suggestions_suggestedById_fkey') THEN
    ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_suggestedById_fkey"
      FOREIGN KEY ("suggestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_suggestions_resolvedTagId_fkey') THEN
    ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_resolvedTagId_fkey"
      FOREIGN KEY ("resolvedTagId") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_suggestions_text_check') THEN
    ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_text_check"
      CHECK (char_length("name") BETWEEN 1 AND 80 AND "identity" <> '' AND ("note" IS NULL OR char_length("note") <= 500));
  END IF;
END
$$;

-- ── Not reachable through the Data API (same treatment as 20261012110000 and 20261024120000) ──────────
REVOKE EXECUTE ON FUNCTION guard_tag_alias() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_tag_name_against_aliases() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_tag_alias() FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_tag_name_against_aliases() FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "tag_aliases" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "tag_suggestions" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_tag_alias() FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION guard_tag_name_against_aliases() FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "tag_aliases" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "tag_suggestions" FROM authenticated';
  END IF;
END
$$;

ALTER TABLE "tag_aliases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tag_suggestions" ENABLE ROW LEVEL SECURITY;
