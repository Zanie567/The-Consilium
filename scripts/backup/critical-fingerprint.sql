-- Critical content fingerprint. READ-ONLY (a single SELECT).
--
-- Run it on production immediately AFTER a backup (Supabase SQL editor; export as CSV) and pass that file to
-- restore-rehearsal.sh --expected-critical: the restored copy must give the same lines. It ties the backup to
-- the live database by the identity of the rows that matter most, not just their number.
--
-- Counts and md5s of sorted primary keys only: no row contents, no personal data. A row edited in place keeps its id,
-- so this does not detect edits; restore-rehearsal.sh compares every row's full content with the dump for that.
select 'articles' as item, count(*) as n, md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) as fp from public.articles
union all select 'articles_public', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), ''))
  from public.articles where status = 'PUBLISHED' and "deletedAt" is null
union all select 'users', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.users
union all select 'debates', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.debates
union all select 'debates_public', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), ''))
  from public.debates where "deletedAt" is null and "unpublishedAt" is null
union all select 'debate_votes', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.debate_votes
union all select 'subscribers', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.subscribers
union all select 'team_members', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.team_members
union all select 'comments', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.comments
union all select 'audit_logs', count(*), md5(coalesce(string_agg(id, ',' order by id collate "C"), '')) from public.audit_logs
order by item;
