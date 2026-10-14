-- Security and structure fingerprint of the public schema. READ-ONLY (a single SELECT).
--
-- Run it on production (Supabase SQL editor, or psql) and on any restored copy, export both as CSV, and compare them
-- line by line (`diff prod.csv restored.csv`). Every line must be identical before a restored database is exposed to
-- users. A restore loads the tables, rows and the grants that exist, but NOT the absence of others: the target
-- database's own default privileges can add grants (a Supabase image grants anon and authenticated full privileges
-- on new tables), so the privilege lines are the ones most likely to differ. See docs/remediation/backup-and-verify.md.
--
-- One line per check: what is counted, how many, and an md5 over the sorted details. Names, privileges and
-- definitions only: no row contents, no personal data, no secrets.
with
tables as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
),
table_grants as (
  select t.relname || ':' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type as d
    from tables t, aclexplode(coalesce(t.relacl, acldefault('r', (select relowner from pg_class where oid = t.oid)))) a
),
column_grants as (
  select t.relname || '.' || att.attname || ':' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type as d
    from tables t
    join pg_attribute att on att.attrelid = t.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
    , aclexplode(att.attacl) a
),
functions as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosecdef, p.proconfig, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
checks as (
  select 'tables' as item, count(*) as n, md5(coalesce(string_agg(relname, ',' order by relname), '')) as fp from tables
  union all
  select 'rls_enabled', count(*) filter (where relrowsecurity),
         md5(coalesce(string_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity, ',' order by relname), ''))
    from tables
  union all
  select 'table_grants', count(*), md5(coalesce(string_agg(d, ',' order by d), '')) from table_grants
  union all
  -- The roles that hold any table privilege. On production this is postgres and service_role only.
  select 'table_grantees: ' || coalesce(string_agg(distinct split_part(d, ':', 2), ' ' order by split_part(d, ':', 2)), '(none)'),
         count(distinct split_part(d, ':', 2)), '' from table_grants
  union all
  select 'column_grants', count(*), md5(coalesce(string_agg(d, ',' order by d), '')) from column_grants
  union all
  select 'policies', count(*),
         md5(coalesce(string_agg(tablename || ':' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' ||
                                 coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname), ''))
    from pg_policies where schemaname = 'public'
  union all
  select 'functions', count(*),
         md5(coalesce(string_agg(sig || ':definer=' || prosecdef || ':' || coalesce(array_to_string(proconfig, ';'), ''), ',' order by sig), ''))
    from functions
  union all
  select 'function_execute_grants', count(*),
         md5(coalesce(string_agg(d, ',' order by d), ''))
    from (select f.sig || ':' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type as d
            from functions f, aclexplode(coalesce(f.proacl, acldefault('f', (select proowner from pg_proc where oid = f.oid)))) a) x
  union all
  select 'triggers', count(*),
         md5(coalesce(string_agg(tg.tgname || ':' || tg.tgenabled::text || ':' || pg_get_triggerdef(tg.oid), ',' order by tg.tgname), ''))
    from pg_trigger tg join tables t on t.oid = tg.tgrelid where not tg.tgisinternal
  union all
  select 'constraints', count(*),
         md5(coalesce(string_agg(t.relname || ':' || co.conname || ':' || co.contype::text || ':' || pg_get_constraintdef(co.oid), ',' order by t.relname, co.conname), ''))
    from pg_constraint co join tables t on t.oid = co.conrelid
  union all
  select 'indexes', count(*), md5(coalesce(string_agg(indexdef, ',' order by indexdef), ''))
    from pg_indexes where schemaname = 'public'
  union all
  select 'invalid_indexes', count(*), ''
    from pg_index i join tables t on t.oid = i.indrelid where not (i.indisvalid and i.indisready)
  union all
  select 'schema_public_acl', 1, md5(coalesce((select nspacl::text from pg_namespace where nspname = 'public'), ''))
  union all
  -- Default privileges decide what FUTURE tables grant (for example to anon/authenticated).
  select 'default_privileges_public', count(*),
         md5(coalesce(string_agg(pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text || ':' || d.defaclacl::text, ','
                                 order by pg_get_userbyid(d.defaclrole), d.defaclobjtype), ''))
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public'
  union all
  select 'extensions: ' || coalesce(string_agg(extname, ' ' order by extname), ''), count(*),
         md5(coalesce(string_agg(extname || '=' || extversion, ',' order by extname), ''))
    from pg_extension
)
select item, n, fp from checks order by item;
