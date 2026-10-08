-- Exact row count of every table in the public schema. READ-ONLY (a single SELECT).
--
-- Run it in the Supabase SQL editor immediately BEFORE the backup and again immediately AFTER, and export each
-- result as CSV (the "Export" button in the results panel). The verifier compares the backup against those counts.
-- Run it a third time on the restored copy if you do the optional restore test.
--
-- It returns table names and numbers only: no row contents, no personal data.
select
  table_name,
  (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
    as row_count
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
