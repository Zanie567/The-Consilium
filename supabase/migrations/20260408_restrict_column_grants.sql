-- =============================================================================
-- Migration: Restrict column-level grants: remove sensitive column exposure
-- Date: 2026-04-08
-- =============================================================================
--
-- PROBLEM:
-- Supabase's project initialisation runs:
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- These table-level grants give SELECT on EVERY column (including passwords,
-- tokens, emails, session tokens, etc.) to the anon and authenticated roles.
-- Supabase's security advisor flags this as sensitive_columns_exposed even
-- when RLS is enabled, because the column-level SELECT privilege still exists.
--
-- SOLUTION:
-- 1. Revoke all broad table-level grants from anon and authenticated.
-- 2. Revoke default privileges so future tables don't inherit these grants.
-- 3. Grant SELECT on only the specific safe columns of the 6 public tables.
--
-- SAFE TABLES + COLUMN ALLOWLISTS (anon can read these):
--   articles     : published content only (RLS enforces status='PUBLISHED');
--                   editorNote and scheduledAt are excluded (editorial-internal)
--   categories   : all columns safe
--   series       : all columns safe
--   tags         : all columns safe
--   team_members : email excluded (staff PII)
--   article_tags : all columns safe
--
-- BLOCKED TABLES (no column grants at all for anon/authenticated):
--   accounts, article_notes, article_views, bookmarks, category_editors,
--   contact_messages, login_attempts, notifications, password_reset_tokens,
--   reading_progress, sessions, subscribers, users, verification_tokens
--
-- No app code is affected: Prisma connects as the postgres superuser which
-- bypasses both RLS and column-level privileges entirely.
-- =============================================================================


-- =============================================================================
-- STEP 1: Revoke ALL table-level privileges from anon and authenticated
--
-- Supabase's default setup grants SELECT + INSERT + UPDATE + DELETE + TRUNCATE
-- + REFERENCES + TRIGGER on every table to both anon and authenticated roles.
-- This single statement clears all of them, including column-level grants that
-- PostgreSQL removes together with table-level grants via REVOKE ALL.
-- =============================================================================

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM authenticated;


-- =============================================================================
-- STEP 2: Revoke default privileges so future tables don't inherit these grants
-- (Supabase sets these via ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...)
-- =============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;


-- =============================================================================
-- STEP 3: Grant SELECT on safe columns only for publicly-readable tables
--
-- Column names are quoted because Prisma creates them with camelCase, which
-- PostgreSQL stores case-sensitively when using quoted identifiers.
-- =============================================================================

-- articles: exclude editorNote (internal editorial feedback) and scheduledAt
--           (internal scheduling data). correctionNote is intentionally included
--           as it is a public-facing editorial correction notice.
GRANT SELECT (
  id,
  title,
  slug,
  content,
  excerpt,
  "coverImage",
  "categoryId",
  "authorId",
  status,
  "publishedAt",
  "isFeatured",
  "isPinned",
  corrected,
  "correctionNote",
  "viewCount",
  "seriesId",
  "seriesOrder",
  "createdAt",
  "updatedAt"
) ON articles TO anon;

-- categories: all columns are safe
GRANT SELECT (id, name, slug, "createdAt") ON categories TO anon;

-- series: all columns are safe
GRANT SELECT (id, title, slug, description, "createdAt") ON series TO anon;

-- tags: all columns are safe
GRANT SELECT (id, name, slug, "createdAt") ON tags TO anon;

-- team_members: email excluded (staff personal email addresses)
GRANT SELECT (id, name, role, bio, image, "order", "isActive") ON team_members TO anon;

-- article_tags: all columns are safe
GRANT SELECT ("articleId", "tagId") ON article_tags TO anon;


-- =============================================================================
-- STEP 4: Verification queries (run manually after applying)
-- =============================================================================
--
-- Confirm only safe column-level grants exist for anon (pg_attribute is the
-- source of truth; information_schema.role_column_grants is misleading as it
-- expands table-level non-SELECT grants to column level):
--
--   SELECT c.relname, a.attname
--   FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid
--   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
--     AND a.attacl IS NOT NULL AND a.attacl::text LIKE '%anon%'
--   ORDER BY c.relname, a.attname;
--
-- Expected tables: article_tags (2 cols), articles (19 cols), categories (4),
--   series (5), tags (4), team_members (7).
-- No rows for: users, sessions, accounts, subscribers, or any other table.
-- No columns named: password, token, email, editorNote, scheduledAt,
--   sessionToken, refresh_token, access_token, id_token, adminNotes, etc.
--
-- Confirm no table-level grants remain for anon:
--   SELECT relname FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
--     AND relacl::text LIKE '%anon=r%';
-- Expected: (0 rows)
