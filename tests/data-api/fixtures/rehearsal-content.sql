-- Synthetic content for the rollout rehearsal, shaped like production's exposure on 2026-10-22:
-- live and trashed published articles, an active and an inactive team card, one stored image.
BEGIN;
INSERT INTO users (id, name, slug, email, role, "updatedAt")
  VALUES ('rehearsal-author', 'Rehearsal Author', 'rehearsal-author', 'rehearsal@example.test', 'WRITER', now());
INSERT INTO categories (id, name, slug) VALUES ('rehearsal-category', 'Rehearsal', 'rehearsal');
INSERT INTO articles (id, title, slug, content, "authorId", "categoryId", status, "publishedAt", "deletedAt", "updatedAt") VALUES
  ('rehearsal-live-1', 'Live one', 'live-one', 'synthetic', 'rehearsal-author', 'rehearsal-category', 'PUBLISHED', now(), NULL, now()),
  ('rehearsal-live-2', 'Live two', 'live-two', 'synthetic', 'rehearsal-author', 'rehearsal-category', 'PUBLISHED', now(), NULL, now()),
  ('rehearsal-trash-1', 'Trash one', 'trash-one', 'synthetic', 'rehearsal-author', 'rehearsal-category', 'PUBLISHED', now(), now(), now()),
  ('rehearsal-trash-2', 'Trash two', 'trash-two', 'synthetic', 'rehearsal-author', 'rehearsal-category', 'PUBLISHED', now(), now(), now());
INSERT INTO team_members (id, name, role, "isActive", "updatedAt") VALUES
  ('rehearsal-active', 'Active', 'Editor', true, now()), ('rehearsal-inactive', 'Inactive', 'Writer', false, now());
INSERT INTO storage.objects (bucket_id, name) VALUES ('article-images', 'articles/rehearsal.png');
COMMIT;
