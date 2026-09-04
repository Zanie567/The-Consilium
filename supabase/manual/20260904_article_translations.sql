-- =============================================================================
-- Migration: article_translations
-- Date: 2026-09-04
-- =============================================================================
--
-- Adds the cache table backing reader-facing machine translation of articles.
--
-- PURELY ADDITIVE. No existing table, column, constraint or grant is altered or
-- dropped. The canonical English article in `articles` is never written by the
-- translation path; every row here is derived content that can be deleted at
-- any time, at the cost of paying to regenerate it.
--
-- Re-running this file is harmless: every statement is IF NOT EXISTS, and
-- ENABLE ROW LEVEL SECURITY on a table that already has it is a no-op.
--
-- KEYS
--   (article_id, locale) is unique: exactly one row per article per language.
--   Storage is therefore bounded at articles x supported locales rather than
--   growing with every edit.
--
--   source_hash   SHA-256 of the exact strings sent to the translation
--                 provider (title, excerpt, and the leaf strings of the TipTap
--                 document). A row whose hash no longer matches the article is
--                 stale by construction and is regenerated instead of served.
--   glossary_hash SHA-256 of the glossary terms occurring in the article, so a
--                 glossary edit refreshes definitions without paying to
--                 retranslate the body.
--
-- ACCESS MODEL (see 20260408_enable_rls.sql for the full notes)
--   Prisma connects as the postgres superuser and bypasses RLS, so no
--   application query is affected. RLS is enabled with no policy, which is
--   deny-by-default, as defence-in-depth for the PostgREST surface reached by
--   the `anon` role. No table-level or column-level grants are issued: this
--   table is not public content and is never read through PostgREST.
-- =============================================================================

CREATE TABLE IF NOT EXISTS article_translations (
  id             TEXT        PRIMARY KEY,
  article_id     TEXT        NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  locale         TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  excerpt        TEXT,
  content        TEXT        NOT NULL,
  source_hash    TEXT        NOT NULL,
  glossary_hash  TEXT        NOT NULL,
  glossary_terms JSONB       NOT NULL DEFAULT '[]'::jsonb,
  provider       TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS article_translations_article_id_locale_key
  ON article_translations (article_id, locale);

CREATE INDEX IF NOT EXISTS article_translations_article_id_idx
  ON article_translations (article_id);

ALTER TABLE article_translations ENABLE ROW LEVEL SECURITY;
