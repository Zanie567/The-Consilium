BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM subscribers GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Subscriber canonical duplicates require reviewed reconciliation before migration';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_normalized_email_key ON subscribers (lower(btrim(email)));
COMMIT;
