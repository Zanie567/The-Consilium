-- =============================================================================
-- Migration: Enable Row-Level Security on all tables
-- Date: 2026-04-08
-- =============================================================================
--
-- ARCHITECTURE NOTES:
--
-- This app uses Prisma with the Supabase postgres superuser connection string.
-- Superusers bypass RLS automatically in PostgreSQL, so NO existing Prisma
-- queries or API routes are affected by enabling RLS.
--
-- The Supabase client SDK is used only for Storage (file uploads): not for
-- any database table reads/writes: so RLS on tables does not affect uploads.
--
-- This app uses NextAuth (not Supabase Auth), so the `authenticated` role from
-- Supabase Auth is never populated. All PostgREST access is via the `anon` role.
--
-- Access model:
--   anon role   → publicly readable content only (published articles, categories, etc.)
--   service_role → bypasses RLS automatically (Supabase built-in)
--   postgres user → bypasses RLS automatically (superuser)
--
-- =============================================================================


-- =============================================================================
-- SECTION 1: Enable RLS on all tables (no existing policies: deny-by-default)
-- =============================================================================

ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_views        ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_editors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE series               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_tokens  ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 2: Public read policies (anon role)
-- Tables where anonymous/unauthenticated access via PostgREST is intentional.
-- =============================================================================

-- categories: always publicly readable (used in site navigation)
CREATE POLICY "anon_read_categories"
  ON categories FOR SELECT TO anon USING (true);

-- series: always publicly readable
CREATE POLICY "anon_read_series"
  ON series FOR SELECT TO anon USING (true);

-- tags: always publicly readable
CREATE POLICY "anon_read_tags"
  ON tags FOR SELECT TO anon USING (true);

-- team_members: always publicly readable (team page)
CREATE POLICY "anon_read_team_members"
  ON team_members FOR SELECT TO anon USING (true);

-- articles: only PUBLISHED articles are publicly readable.
-- DRAFT, PENDING_REVIEW, SCHEDULED, ARCHIVED, REJECTED are never exposed.
CREATE POLICY "anon_read_published_articles"
  ON articles FOR SELECT TO anon
  USING (status = 'PUBLISHED');

-- article_tags: only tags on published articles are publicly readable.
-- This prevents enumerating tags on drafts or scheduled posts.
-- Note: Prisma preserves camelCase column names from the schema ("articleId", not "article_id").
CREATE POLICY "anon_read_published_article_tags"
  ON article_tags FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM articles
      WHERE articles.id = article_tags."articleId"
        AND articles.status = 'PUBLISHED'
    )
  );


-- =============================================================================
-- SECTION 3: Fully restricted tables
-- RLS is enabled above with NO policies for anon: deny-by-default applies.
-- These tables are only accessible via the postgres superuser (Prisma) or
-- service_role (both bypass RLS automatically).
--
-- Tables and why they are fully restricted:
--   accounts            : NextAuth OAuth tokens; never expose externally
--   article_notes       : editorial-only internal notes
--   article_views       : view-count tracking; write-only from API routes
--   bookmarks           : private per-user reading lists
--   category_editors    : internal role assignments
--   contact_messages    : private contact form submissions
--   login_attempts      : security audit log; sensitive
--   notifications       : private per-user notifications
--   password_reset_tokens: sensitive tokens; never expose
--   reading_progress    : private per-user progress data
--   sessions            : NextAuth session tokens; never expose
--   subscribers         : private email list
--   users               : user PII and hashed passwords; never expose
--   verification_tokens : NextAuth email verification; never expose
-- =============================================================================

-- (No policies needed: deny-by-default when RLS is enabled without policies)


-- =============================================================================
-- SECTION 4: Verification query
-- Run this after applying to confirm all tables have RLS enabled.
-- =============================================================================
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- All rows should show rowsecurity = true.
