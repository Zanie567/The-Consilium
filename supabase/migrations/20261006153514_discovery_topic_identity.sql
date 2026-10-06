-- Additive identity enforcement: preserve all stored tag IDs and URLs.
-- Preflight aborts on canonical duplicates; an owner must reconcile those explicitly.
BEGIN;
CREATE OR REPLACE FUNCTION public.consilium_tag_identity(label text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT trim(both '-' from regexp_replace(replace(replace(lower(normalize(label, NFKC)), U&'i\0307', 'i'), U&'\03C2', U&'\03C3'), '[^[:alnum:]]+', '-', 'g')) $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tags WHERE public.consilium_tag_identity(name) = '') THEN
    RAISE EXCEPTION 'Topic identity preflight: empty canonical names require explicit reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tags GROUP BY public.consilium_tag_identity(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Topic identity preflight: duplicate canonical names require explicit reconciliation; preserve old URLs';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS tags_canonical_identity_key ON public.tags (public.consilium_tag_identity(name));
CREATE INDEX IF NOT EXISTS "article_tags_tagId_articleId_idx" ON public.article_tags ("tagId", "articleId");
ALTER TABLE public.article_tags DROP CONSTRAINT IF EXISTS "article_tags_tagId_fkey";
ALTER TABLE public.article_tags ADD CONSTRAINT "article_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES public.tags(id) ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
