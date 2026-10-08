BEGIN;
-- Match JavaScript String.trim(), including historical tabs/newlines/NBSP/BOM.
CREATE OR REPLACE FUNCTION public.consilium_subscriber_identity(label text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT lower(btrim(label, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM subscribers GROUP BY public.consilium_subscriber_identity(email) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Subscriber canonical duplicates require reviewed reconciliation before migration';
 END IF;
END $$;
-- Replaying the unreleased candidate on a local DB replaces its older space-only index.
DROP INDEX IF EXISTS public.subscribers_normalized_email_key;
CREATE UNIQUE INDEX subscribers_normalized_email_key ON subscribers (public.consilium_subscriber_identity(email));
COMMIT;
