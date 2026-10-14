-- ACTION REQUIRED: Run this SQL in the Supabase SQL editor.
--
-- Adds the quoted_text column used to re-anchor inline review comments after
-- a draft is edited. Safe to run whether or not the column already exists.
--
-- Order of operations in production:
--   1. If the article_comments table does NOT exist yet, run
--      add_article_comments.sql first (it already includes quoted_text, in
--      which case this file is a harmless no-op).
--   2. Run this file.

ALTER TABLE article_comments ADD COLUMN IF NOT EXISTS quoted_text TEXT;
