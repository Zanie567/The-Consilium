-- New uploads only. Existing buckets/objects/URLs are unchanged.
-- A reserved row precedes Storage upload so interrupted requests remain collectible.
BEGIN;
CREATE TABLE IF NOT EXISTS public.article_image_assets (
  url text PRIMARY KEY,
  path text NOT NULL UNIQUE,
  "uploaderId" text NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "unusedSince" timestamptz(3) DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "article_image_assets_unusedSince_createdAt_idx" ON public.article_image_assets ("unusedSince", "createdAt");
CREATE INDEX IF NOT EXISTS "article_image_assets_uploaderId_idx" ON public.article_image_assets ("uploaderId");
ALTER TABLE public.article_image_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.article_image_assets FROM PUBLIC;
-- No browser policies: NextAuth-authorised server routes own every write.
COMMIT;
