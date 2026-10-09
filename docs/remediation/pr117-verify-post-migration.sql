-- READ-ONLY post-migration verification for the four PR #117 migrations (and, separately, article_comments).
--
-- Safe to run at any time against production, in the Supabase SQL editor or psql. It is ONE SELECT
-- statement: it creates, changes and grants nothing. It returns object names, booleans and row COUNTS
-- only; it never returns subscriber addresses, tag names, article text or any other row content.
--
-- How to read it: every row has result 'ok', 'FAIL' or 'info'.
--   * Any 'FAIL' means the database no longer matches what the deployed code and the completed
--     remediation expect. Do NOT "fix" it by re-running migrations or the historical rollback script;
--     read docs/remediation/pr117-database-migrations.md (sections 4, 6 and 10) first.
--   * 'info' rows are context (row counts, server version), not pass/fail.
--
-- What this proves: the database objects, constraints, row-level security and privileges that the
-- remediation created are present and still locked down. What it does NOT prove: that any feature works
-- end to end. Newsletter sign-up, tagged saves, image upload and reading analytics each still need a
-- real application smoke test (see section 5 of the document).
--
-- Tested by tests/integration/pr117-migrations-rehearsal.test.ts (inside a READ ONLY transaction).

with expected_tables(tbl) as (
  values ('article_image_assets'), ('article_engagement_sessions')
),
expected_indexes(idx) as (
  values ('tags_canonical_identity_key'), ('subscribers_normalized_email_key'), ('article_tags_tagId_articleId_idx'),
         ('article_image_assets_pkey'), ('article_image_assets_path_key'),
         ('article_image_assets_unusedSince_createdAt_idx'), ('article_image_assets_uploaderId_idx'),
         ('article_engagement_sessions_pkey'), ('article_engagement_sessions_articleId_startedAt_idx'),
         ('article_engagement_sessions_startedAt_idx'), ('article_engagement_sessions_readerHash_startedAt_idx')
),
-- Anyone who must have NO privilege on the server-only tables: PUBLIC (grantee 0), anon, authenticated.
closed_grantees as (
  select 0::oid as oid, 'PUBLIC'::text as name
  union all select oid, rolname::text from pg_roles where rolname in ('anon', 'authenticated')
)

select * from (
-- 1. Functions: present, IMMUTABLE (required for the unique expression indexes), not SECURITY DEFINER.
select 'function ' || f as check_name,
       case when p.oid is not null and p.provolatile = 'i' and not p.prosecdef then 'ok' else 'FAIL' end as result,
       case when p.oid is null then 'missing' else 'volatility=' || p.provolatile::text || ' security_definer=' || p.prosecdef::text end as detail
from (values ('consilium_tag_identity'), ('consilium_subscriber_identity')) e(f)
left join pg_proc p on p.proname = e.f and p.pronamespace = 'public'::regnamespace and p.pronargs = 1

-- 2. Tables exist.
union all
select 'table ' || tbl, case when to_regclass('public.' || tbl) is not null then 'ok' else 'FAIL' end,
       case when to_regclass('public.' || tbl) is not null then 'present' else 'missing' end
from expected_tables

-- 3. Indexes exist.
union all
select 'index ' || idx, case when to_regclass('public."' || idx || '"') is not null then 'ok' else 'FAIL' end,
       case when to_regclass('public."' || idx || '"') is not null then 'present' else 'missing' end
from expected_indexes

-- 4. The two identity indexes are UNIQUE (they are what stop duplicate topics and duplicate subscribers).
union all
select 'unique ' || i.indexname, case when i.indexdef like 'CREATE UNIQUE INDEX%' then 'ok' else 'FAIL' end, 'unique=' || (i.indexdef like 'CREATE UNIQUE INDEX%')::text
from pg_indexes i
where i.schemaname = 'public' and i.indexname in ('tags_canonical_identity_key', 'subscribers_normalized_email_key')

-- 5. article_tags.tagId foreign key: exactly one, RESTRICT on delete (was CASCADE before PR #117).
union all
select 'fk article_tags_tagId_fkey is RESTRICT',
       case when count(*) = 1 and bool_and(confdeltype = 'r') then 'ok' else 'FAIL' end,
       'constraints=' || count(*) || ' delete_rules=' || coalesce(string_agg(confdeltype::text, ','), 'none')
from pg_constraint where conrelid = 'public.article_tags'::regclass and contype = 'f' and conname = 'article_tags_tagId_fkey'

-- 6. article_engagement_sessions: foreign key to articles cascades; the activeSeconds check exists.
union all
select 'fk article_engagement_sessions -> articles (CASCADE)',
       case when count(*) filter (where confdeltype = 'c' and confrelid = 'public.articles'::regclass) = 1 then 'ok' else 'FAIL' end,
       'fks=' || count(*)
from pg_constraint where conrelid = to_regclass('public.article_engagement_sessions') and contype = 'f'
union all
select 'check article_engagement_sessions_activeSeconds_check',
       case when count(*) = 1 then 'ok' else 'FAIL' end, 'checks=' || count(*)
from pg_constraint where conrelid = to_regclass('public.article_engagement_sessions') and contype = 'c' and conname = 'article_engagement_sessions_activeSeconds_check'

-- 7. Row-level security is on and there are NO policies (these tables are server-only).
union all
select 'rls ' || tbl, case when c.relrowsecurity then 'ok' else 'FAIL' end, 'rls_enabled=' || coalesce(c.relrowsecurity::text, 'table missing')
from expected_tables t left join pg_class c on c.oid = to_regclass('public.' || t.tbl)
union all
select 'no policies on ' || tbl,
       case when (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tbl) = 0 then 'ok' else 'FAIL' end,
       'policies=' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tbl)
from expected_tables t

-- 8. Privileges: PUBLIC, anon and authenticated hold NO table-level and NO column-level privilege.
--    (A row that says "FAIL" here means the API roles could reach the table if row-level security were
--    ever weakened. Production passed this on 2026-10-09; see section 6 of the document for why.)
union all
select 'no API-role privileges on ' || tbl,
       case when n_table + n_column = 0 then 'ok' else 'FAIL' end,
       'table_grants=' || n_table || ' column_grants=' || n_column
from (
  select t.tbl,
    (select count(*) from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       join closed_grantees g on g.oid = a.grantee
     where c.oid = to_regclass('public.' || t.tbl)) as n_table,
    (select count(*) from pg_attribute at
       cross join lateral aclexplode(at.attacl) a
       join closed_grantees g on g.oid = a.grantee
     where at.attrelid = to_regclass('public.' || t.tbl) and at.attacl is not null) as n_column
  from expected_tables t
) x

-- 9. The separate, older article_comments table (PR #97): present, RLS on.
union all
select 'table article_comments (separate migration)',
       case when c.oid is not null and c.relrowsecurity then 'ok' else 'FAIL' end,
       case when c.oid is null then 'missing' else 'rls_enabled=' || c.relrowsecurity end
from (select 1) one left join pg_class c on c.oid = to_regclass('public.article_comments')

-- 10. The two functions return the expected canonical form (a cheap behavioural spot check).
union all
select 'function results',
       case when to_regprocedure('public.consilium_subscriber_identity(text)') is null
              or to_regprocedure('public.consilium_tag_identity(text)') is null then 'FAIL'
            when (xpath('/row/c/text()', query_to_xml(
                   $q$select public.consilium_subscriber_identity('  Reader@Example.Test ') || '|' || public.consilium_tag_identity('Investment & Finance') as c$q$,
                   false, true, '')))[1]::text = 'reader@example.test|investment-finance' then 'ok'
            else 'FAIL' end,
       'subscriber + tag identity spot check (run dynamically so a missing function is reported, not an error)'

-- 11. Context only: row counts (never row contents) and server version.
union all
select 'rows in ' || tbl, 'info',
       case when to_regclass('public.' || tbl) is null then 'table missing'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || quote_ident(tbl), false, true, '')))[1]::text end
from expected_tables
union all
select 'server_version', 'info', current_setting('server_version')
) r(check_name, result, detail)
order by (result <> 'FAIL'), (result = 'info'), check_name;
