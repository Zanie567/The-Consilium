-- Minimal stand-in for Supabase's `storage` schema in the LOCAL test database, with
-- the exact column set of production's storage.buckets (inspected read-only on
-- 2026-10-01), so supabase/migrations/20261001_team_member_user_link.sql can be run
-- for real. Only the pre-existing `article-images` bucket is seeded, as in production.
CREATE SCHEMA IF NOT EXISTS storage;
DO $$ BEGIN
  CREATE TYPE storage.buckettype AS ENUM ('STANDARD', 'ANALYTICS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  owner              uuid,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  public             boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  owner_id           text,
  type               storage.buckettype NOT NULL DEFAULT 'STANDARD'
);
INSERT INTO storage.buckets (id, name, public) VALUES ('article-images', 'article-images', true)
ON CONFLICT (id) DO NOTHING;
