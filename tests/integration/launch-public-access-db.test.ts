import { expect, it } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertRunDatabase } from '../../scripts/lib/assertRunDatabase'

it('closes Data API soft-delete/team/upload bypasses without changing title validation or server access', async () => {
  assertRunDatabase()
  const base = process.env.TEST_DATABASE_URL!
  const name = `consilium_launch_${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: base })
  const target = new URL(base)
  target.pathname = `/${name}`
  const db = new Client({ connectionString: target.href })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    await db.connect()
    await db.query(`
      CREATE TABLE public.users (id text primary key);
      CREATE TABLE public.articles (id text primary key, status text, "deletedAt" timestamptz, "hiddenByDebateAt" timestamptz);
      CREATE TABLE public.article_tags ("articleId" text);
      CREATE TABLE public.team_members (id text, "isActive" boolean);
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (bucket_id text);
      ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE article_tags ENABLE ROW LEVEL SECURITY;
      ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public TO anon;
      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT (id, status) ON articles TO anon;
      GRANT SELECT ("articleId") ON article_tags TO anon;
      GRANT SELECT (id) ON team_members TO anon;
      GRANT INSERT ON storage.objects TO authenticated;
      CREATE POLICY anon_read_published_articles ON articles FOR SELECT TO anon USING (status='PUBLISHED');
      CREATE POLICY anon_read_published_article_tags ON article_tags FOR SELECT TO anon USING (
        EXISTS (SELECT 1 FROM articles WHERE articles.id=article_tags."articleId" AND articles.status='PUBLISHED'));
      CREATE POLICY anon_read_team_members ON team_members FOR SELECT TO anon USING (true);
      CREATE POLICY "Allow authenticated uploads qt2lnz_0" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='article-images');
      INSERT INTO articles VALUES ('visible','PUBLISHED',null,null),('trashed','PUBLISHED',now(),null),('hidden','PUBLISHED',null,now()),('draft','DRAFT',null,null);
      INSERT INTO article_tags VALUES ('visible'),('trashed'),('hidden'),('draft');
      INSERT INTO team_members VALUES ('visible',true),('inactive',false);
    `)
    await db.query(readFileSync('supabase/migrations/20261005000000_user_display_titles.sql', 'utf8'))
    await db.query('SET ROLE anon')
    expect((await db.query('SELECT id FROM articles')).rowCount).toBe(3)
    expect((await db.query('SELECT id FROM team_members')).rowCount).toBe(2)
    await db.query('RESET ROLE')
    const migration = readFileSync('supabase/migrations/20261018002859_launch_public_access_hardening.sql', 'utf8')
    await db.query(migration)
    await db.query(migration) // repeat application is safe
    await db.query('SET ROLE anon')
    expect((await db.query('SELECT id FROM articles')).rows).toEqual([{ id: 'visible' }])
    expect((await db.query('SELECT "articleId" FROM article_tags')).rows).toEqual([{ articleId: 'visible' }])
    expect((await db.query('SELECT id FROM team_members')).rows).toEqual([])
    await expect(db.query('SELECT id FROM users')).rejects.toMatchObject({ code: '42501' })
    await db.query('RESET ROLE; SET ROLE authenticated')
    await expect(db.query("INSERT INTO storage.objects VALUES ('article-images')")).rejects.toMatchObject({ code: '42501' })
    await db.query('RESET ROLE')
    expect((await db.query('SELECT id FROM articles')).rowCount).toBe(4)
    const validation = await db.query(`SELECT
      public.users_display_titles_valid(ARRAY['Writer']) AS valid,
      public.users_display_titles_valid(ARRAY['Writer','Writer']) AS duplicate,
      public.users_display_titles_valid(ARRAY['Invalid']) AS invalid,
      public.users_display_titles_valid(null) AS missing`)
    expect(validation.rows).toEqual([{ valid: true, duplicate: false, invalid: false, missing: false }])
    expect((await db.query("SELECT proconfig,prosecdef FROM pg_proc WHERE proname='users_display_titles_valid'")).rows)
      .toEqual([{ proconfig: ['search_path=pg_catalog'], prosecdef: false }])
  } finally {
    await db.end()
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
}, 30000)
