-- Objects that exist on production but were created in the Supabase dashboard, not by a
-- migration (read-only catalog inspection, 2026-10-22). Recreated here so the tests start
-- from production's actual state. Disposable local stack only.
BEGIN;
INSERT INTO storage.buckets (id, name, public)
  VALUES ('article-images', 'article-images', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow authenticated uploads qt2lnz_0" ON storage.objects;
CREATE POLICY "Allow authenticated uploads qt2lnz_0" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'article-images');

DROP POLICY IF EXISTS "Allow public reads qt2lnz_0" ON storage.objects;
CREATE POLICY "Allow public reads qt2lnz_0" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'article-images');
COMMIT;
