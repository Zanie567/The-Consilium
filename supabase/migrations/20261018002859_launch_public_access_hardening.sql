-- Review/apply separately after approval. This audit never applies production SQL.
-- The website uses Prisma, while these policies govern the independent Data API.
BEGIN;

-- Pure validation using built-ins only; preserve invoker security and its CHECK constraint.
ALTER FUNCTION public.users_display_titles_valid(text[]) SET search_path = pg_catalog;

-- Soft deletion preserves status. The old status-only policy disclosed trashed articles.
ALTER POLICY anon_read_published_articles ON public.articles
  USING (status = 'PUBLISHED' AND "deletedAt" IS NULL AND "hiddenByDebateAt" IS NULL);

-- Evaluate through the article's RLS, so tags cannot advertise a trashed article.
ALTER POLICY anon_read_published_article_tags ON public.article_tags
  USING (EXISTS (
    SELECT 1 FROM public.articles
    WHERE articles.id = article_tags."articleId" AND articles.status = 'PUBLISHED'
  ));

-- The public roster combines card visibility with linked-account moderation.
-- A direct table read cannot reproduce that without exposing users; the app
-- already serves the complete roster through Prisma, not the Supabase client.
ALTER POLICY anon_read_team_members ON public.team_members USING (false);

-- App uploads use the server service role after NextAuth RBAC, limits and decoding.
-- Supabase Auth JWTs must not provide an independent, unchecked upload path.
DROP POLICY IF EXISTS "Allow authenticated uploads qt2lnz_0" ON storage.objects;

COMMIT;
