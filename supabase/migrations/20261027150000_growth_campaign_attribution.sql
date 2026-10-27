-- Additive, idempotent attribution fields. Historical rows stay NULL: never
-- invent campaign or arrival information for preexisting view events.
-- Source/medium/campaign labels are bounded, validated before persistence.
ALTER TABLE public.article_views
  ADD COLUMN IF NOT EXISTS "entryKind" text,
  ADD COLUMN IF NOT EXISTS "campaignSource" text,
  ADD COLUMN IF NOT EXISTS "campaignMedium" text,
  ADD COLUMN IF NOT EXISTS "campaignName" text,
  ADD COLUMN IF NOT EXISTS "campaignContent" text;

ALTER TABLE public.site_views
  ADD COLUMN IF NOT EXISTS "entryKind" text,
  ADD COLUMN IF NOT EXISTS "campaignSource" text,
  ADD COLUMN IF NOT EXISTS "campaignMedium" text,
  ADD COLUMN IF NOT EXISTS "campaignName" text,
  ADD COLUMN IF NOT EXISTS "campaignContent" text;

-- Existing table RLS and Data API grants remain unchanged.
-- No view records, subscriber rows, or unique indexes are rewritten.
CREATE INDEX IF NOT EXISTS article_views_campaign_name_date_idx
  ON public.article_views ("campaignName", "viewedAt")
  WHERE "campaignName" IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_views_campaign_name_date_idx
  ON public.site_views ("campaignName", "viewedAt")
  WHERE "campaignName" IS NOT NULL;
