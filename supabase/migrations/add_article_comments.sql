-- ACTION REQUIRED: Run this SQL in the Supabase SQL editor BEFORE deploying
-- the inline review commenting system to production.
--
-- This creates the article_comments table used by the inline review commenting
-- system. It is NOT managed by Prisma migrate - execute it manually.
--
-- If this file was ALREADY applied in production (the table exists), do NOT
-- run it again. Run only add_article_comments_quoted_text.sql, which adds the
-- quoted_text column to the existing table.

CREATE TABLE IF NOT EXISTS article_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  TEXT        NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id   TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  comment_text TEXT       NOT NULL,
  resolved    BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  parent_id   UUID        REFERENCES article_comments(id) ON DELETE CASCADE,
  tiptap_from INTEGER,
  tiptap_to   INTEGER,
  quoted_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article_id ON article_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_article_comments_parent_id  ON article_comments(parent_id);

-- Row-level security: only authenticated service role (used by Next.js server)
-- can read/write; restrict public access.
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by Prisma) full access
CREATE POLICY "service_role_all" ON article_comments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
