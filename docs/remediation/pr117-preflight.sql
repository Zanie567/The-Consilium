-- READ-ONLY preflight for the four PR #117 migrations. Run it in the SQL editor immediately before
-- applying them, and again after. It only SELECTs. It returns counts and names, never row contents
-- (no subscriber addresses, no tag names, no article text).
--
-- How to read it: the "expect" column says what a safe-to-apply database looks like. If any value is
-- not what is expected, stop and read docs/remediation/pr117-database-migrations.md.

-- 1. What is already there? Before applying: all 'absent'. After applying: all 'present'.
select 'function consilium_tag_identity'        as object, case when to_regprocedure('public.consilium_tag_identity(text)')        is null then 'absent' else 'present' end as state, 'absent before / present after' as expect
union all select 'function consilium_subscriber_identity', case when to_regprocedure('public.consilium_subscriber_identity(text)') is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'table article_image_assets',            case when to_regclass('public.article_image_assets')            is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'table article_engagement_sessions',     case when to_regclass('public.article_engagement_sessions')     is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'index tags_canonical_identity_key',     case when to_regclass('public.tags_canonical_identity_key')     is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'index subscribers_normalized_email_key',case when to_regclass('public.subscribers_normalized_email_key') is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'index article_tags_tagId_articleId_idx',case when to_regclass('public."article_tags_tagId_articleId_idx"') is null then 'absent' else 'present' end, 'absent before / present after'
union all select 'table article_comments (separate, older gap)', case when to_regclass('public.article_comments') is null then 'absent' else 'present' end, 'absent today; see the plan';

-- 2. Data that could make a migration refuse (its own preflight raises on these). Expect: all zero.
select 'tags with an empty canonical name' as check_name,
       count(*) filter (where trim(both '-' from regexp_replace(replace(replace(lower(normalize(name, NFKC)), U&'i\0307', 'i'), U&'\03C2', U&'\03C3'), '[^[:alnum:]]+', '-', 'g')) = '') as value,
       'expect 0' as expect
from public.tags
union all
select 'tag canonical-duplicate groups', count(*), 'expect 0'
from (select 1 from public.tags
      group by trim(both '-' from regexp_replace(replace(replace(lower(normalize(name, NFKC)), U&'i\0307', 'i'), U&'\03C2', U&'\03C3'), '[^[:alnum:]]+', '-', 'g'))
      having count(*) > 1) d
union all
select 'subscriber canonical-duplicate groups', count(*), 'expect 0'
from (select 1 from public.subscribers
      group by lower(btrim(email, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))
      having count(*) > 1) d
union all
select 'subscribers with a blank email', count(*), 'expect 0' from public.subscribers where email is null or btrim(email) = '';

-- 3. Sizes and the environment the SQL will run in (normalize() needs UTF8 and Postgres 13+).
select (select count(*) from public.tags)         as tags,
       (select count(*) from public.article_tags) as article_tags,
       (select count(*) from public.subscribers)  as subscribers,
       (select count(*) from public.articles)     as articles,
       current_setting('server_encoding')         as encoding,
       (select datcollate from pg_database where datname = current_database()) as collation,
       current_setting('server_version')          as postgres_version,
       pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 4. The foreign key migration 1 replaces: it must exist under this exact name (so it is replaced,
--    not duplicated). Before: delete rule 'c' (CASCADE). After: 'r' (RESTRICT).
select conname::text as constraint_name, confdeltype::text as delete_rule, confupdtype::text as update_rule
from pg_constraint
where conrelid = 'public.article_tags'::regclass and contype = 'f'
order by conname;

-- 5. Anything that would collide with what the migrations create. Expect: no rows.
select indexname::text as unexpected_existing_index
from pg_indexes
where schemaname = 'public'
  and indexname in ('tags_canonical_identity_key', 'subscribers_normalized_email_key',
                    'article_tags_tagId_articleId_idx', 'article_image_assets_unusedSince_createdAt_idx',
                    'article_image_assets_uploaderId_idx', 'article_engagement_sessions_articleId_startedAt_idx',
                    'article_engagement_sessions_startedAt_idx', 'article_engagement_sessions_readerHash_startedAt_idx');
