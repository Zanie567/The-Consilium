-- Read-only tag audit. Run in the Supabase SQL editor (or psql) against production; it changes nothing.
-- Results feed docs/tags/cleanup-report-2026-11-15.md. Works before AND after migration 20261115120000.
BEGIN TRANSACTION READ ONLY;

-- 1. Every tag with its usage. "published" counts what readers can see; "trashed" is in the bin.
SELECT t.name, t.slug, public.consilium_tag_identity(t.name) AS identity, t."createdAt"::date AS created,
       count(a.id) FILTER (WHERE a."deletedAt" IS NULL)                              AS articles,
       count(a.id) FILTER (WHERE a."deletedAt" IS NULL AND a.status = 'PUBLISHED')   AS published,
       count(a.id) FILTER (WHERE a."deletedAt" IS NOT NULL)                          AS trashed
FROM tags t
LEFT JOIN article_tags at ON at."tagId" = t.id
LEFT JOIN articles a ON a.id = at."articleId"
GROUP BY t.id
ORDER BY lower(t.name);

-- 2. Tags no live article uses (candidates to retire, never to delete: their URLs may be linked).
SELECT t.name, t.slug FROM tags t
WHERE NOT EXISTS (SELECT 1 FROM article_tags at JOIN articles a ON a.id = at."articleId"
                  WHERE at."tagId" = t.id AND a."deletedAt" IS NULL)
ORDER BY lower(t.name);

-- 3. Display names that are not in title case, or have stray spacing.
SELECT name, slug FROM tags
WHERE name <> initcap(name) AND name = lower(name)
   OR name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))
ORDER BY lower(name);

-- 4. Slugs that differ from the name's identity (legacy URLs, or the -<hash> suffix used when a
--    legacy URL already held the canonical slug). These addresses are permanent; listed for awareness.
SELECT name, slug, public.consilium_tag_identity(name) AS identity FROM tags
WHERE slug <> public.consilium_tag_identity(name)
ORDER BY lower(name);

-- 5. Tag names that are also a format (category), which duplicates the format filter.
SELECT t.name AS tag, c.name AS category FROM tags t JOIN categories c
  ON public.consilium_tag_identity(t.name) = public.consilium_tag_identity(c.name);

-- 6. Articles by number of tags (the editor now allows at most 10; 1-3 recommended).
SELECT n AS tags_on_article, count(*) AS articles FROM (
  SELECT a.id, count(at."tagId") AS n FROM articles a LEFT JOIN article_tags at ON at."articleId" = a.id
  WHERE a."deletedAt" IS NULL GROUP BY a.id) x
GROUP BY n ORDER BY n;

COMMIT;
-- Possible duplicates by wording: paste the names from query 1 into /editorial/tags once deployed
-- (the "Possible duplicates" panel runs the same rules as src/lib/tags/taxonomy.ts).
