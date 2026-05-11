-- ACTION REQUIRED: Run this SQL manually in the Supabase SQL editor before deploying.
-- Adds persisted inline review comment threads for the editorial review studio.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS review_comment_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  anchor_text text NOT NULL,
  selected_text text NOT NULL,
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_comment_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES review_comment_threads(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_comment_threads_article_id_idx
  ON review_comment_threads(article_id, resolved, created_at);

CREATE INDEX IF NOT EXISTS review_comment_replies_thread_id_idx
  ON review_comment_replies(thread_id, created_at);
