/**
 * Launch public-access hardening (supabase/migrations/20261018002859_launch_public_access_hardening.sql),
 * proven over the real Data API (PostgREST) and Storage API of a disposable local Supabase stack.
 *
 * The harness leaves the database exactly where production was on 2026-10-22: every applied
 * migration plus the dashboard-created Storage policies. This file first shows the exposures
 * exist, then applies the migration twice (as postgres, which is not a superuser on Supabase),
 * then checks both that the exposures are closed and that every legitimate path still works.
 * All rows are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import {
  PNG_BYTES, connectAsPostgres, env, ids, rest, selfRegisteredToken, serviceStorage, storageRequest,
} from './helpers'

const MIGRATION = readFileSync('supabase/migrations/20261018002859_launch_public_access_hardening.sql', 'utf8')
const run = randomUUID().slice(0, 8)
const id = (name: string) => `${name}-${run}`
const DRAFT_IMAGE = `articles/${id('draft-figure')}.png`

// Tables that hold private, editorial or security data. The Data API must refuse all of them.
const SERVER_ONLY_TABLES = [
  'users', 'accounts', 'sessions', 'verification_tokens', 'password_reset_tokens', 'login_attempts',
  'subscribers', 'contact_messages', 'notifications', 'bookmarks', 'reading_progress',
  'article_notes', 'article_corrections', 'article_views', 'article_engagement_sessions',
  'article_image_assets', 'comments', 'comment_upvotes', 'article_comments', 'debates', 'debate_votes',
  'admin_notes', 'audit_logs', 'user_warnings', 'team_memberships', 'testing_sessions',
  'scheduler_invocations', 'site_settings', 'site_views', 'category_editors', 'article_slug_redirects',
]

let db: Client

beforeAll(async () => {
  db = await connectAsPostgres()
  await db.query(
    `INSERT INTO users (id, name, slug, email, role, "updatedAt") VALUES ($1, 'Fixture Author', $1, $2, 'WRITER', now())`,
    [id('author'), `${id('author')}@example.test`],
  )
  await db.query(`INSERT INTO categories (id, name, slug) VALUES ($1, $1, $1)`, [id('category')])
  await db.query(`INSERT INTO tags (id, name, slug) VALUES ($1, $1, $1)`, [id('tag')])
  const article = (name: string, status: string, extra: string) => db.query(
    `INSERT INTO articles (id, title, slug, content, "authorId", "categoryId", status, "publishedAt",
                           "editorNote", "updatedAt", "deletedAt", "hiddenByDebateAt", "scheduledAt")
     VALUES ($1, $1, $1, 'synthetic body', $2, $3, $4, now(), 'internal note', now(), ${extra})`,
    [id(name), id('author'), id('category'), status],
  )
  await article('visible', 'PUBLISHED', 'NULL, NULL, NULL')
  await article('trashed', 'PUBLISHED', 'now(), NULL, NULL')
  await article('hidden', 'PUBLISHED', 'NULL, now(), NULL')
  await article('draft', 'DRAFT', 'NULL, NULL, NULL')
  await article('scheduled', 'SCHEDULED', "NULL, NULL, now() + interval '1 day'")
  await db.query(`INSERT INTO article_tags ("articleId", "tagId") SELECT id, $2 FROM articles WHERE id LIKE $1`,
    [`%-${run}`, id('tag')])
  await db.query(
    `INSERT INTO team_members (id, name, role, "isActive", email, "updatedAt") VALUES
       ($1, 'Active Member', 'Editor', true, 'a@example.test', now()),
       ($2, 'Inactive Member', 'Writer', false, 'b@example.test', now())`,
    [id('member-active'), id('member-inactive')],
  )
  // The server's upload path (service role) stores an image for a draft that is not public yet.
  const { error } = await serviceStorage().from('article-images')
    .upload(DRAFT_IMAGE, PNG_BYTES, { contentType: 'image/png' })
  expect(error).toBeNull()
})

afterAll(async () => {
  await serviceStorage().from('article-images').remove([DRAFT_IMAGE])
  await db?.end()
})

const mine = (rows: unknown) => (Array.isArray(rows) ? rows.filter((r) => String(r).endsWith(run)) : rows)
const listArticleImages = async (token?: string) => {
  const response = await storageRequest('object/list/article-images', {
    method: 'POST', token, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'articles', limit: 1000 }),
  })
  const body = (await response.json()) as { name: string }[]
  return Array.isArray(body) ? body.map((o) => `articles/${o.name}`) : body
}
const uploadAs = (token: string, bucket: string, name: string, type: string, bytes: BodyInit) =>
  storageRequest(`object/${bucket}/${name}`, { method: 'POST', token, headers: { 'content-type': type }, body: bytes })

describe.sequential('launch public-access hardening over the real Data API and Storage API', () => {
  it('reproduces the exposures production had on 2026-10-22', async () => {
    expect(mine(ids(await rest('articles?select=id')))).toEqual([id('hidden'), id('trashed'), id('visible')])
    const tags = await rest(`article_tags?select=articleId&tagId=eq.${id('tag')}`)
    expect((tags.body as { articleId: string }[]).map((t) => t.articleId).sort())
      .toEqual([id('hidden'), id('trashed'), id('visible')])
    expect(mine(ids(await rest('team_members?select=id')))).toEqual([id('member-active'), id('member-inactive')])
    expect(await listArticleImages()).toContain(DRAFT_IMAGE)

    const token = await selfRegisteredToken()
    const name = `probe/${id('svg')}.svg`
    const upload = await uploadAs(token, 'article-images', name, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(upload.status).toBe(200)
    await serviceStorage().from('article-images').remove([name])
  })

  it('applies twice as postgres, which is not a superuser (as on Supabase)', async () => {
    const role = await db.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: true }])
    await db.query(MIGRATION)
    await db.query(MIGRATION)
  })

  it('anon reads only published, live articles, and still cannot read internal columns', async () => {
    expect(mine(ids(await rest('articles?select=id')))).toEqual([id('visible')])
    expect(await rest(`articles?select=content&id=eq.${id('trashed')}`)).toEqual({ status: 200, body: [] })
    expect(await rest(`articles?select=content&id=eq.${id('hidden')}`)).toEqual({ status: 200, body: [] })
    const visible = await rest(`articles?select=id,title,content,status&id=eq.${id('visible')}`)
    expect(visible.body).toEqual([{ id: id('visible'), title: id('visible'), content: 'synthetic body', status: 'PUBLISHED' }])
    for (const column of ['editorNote', 'deletedAt', 'hiddenByDebateAt', 'scheduledAt', 'engagementScore', 'editorialCommendation']) {
      const result = await rest(`articles?select=${column}&limit=1`)
      expect(result.body, column).toMatchObject({ code: '42501' })
    }
  })

  it('tags follow article visibility; categories and tags stay public', async () => {
    const tags = await rest(`article_tags?select=articleId&tagId=eq.${id('tag')}`)
    expect(tags.body).toEqual([{ articleId: id('visible') }])
    expect((await rest(`categories?select=slug&slug=eq.${id('category')}`)).body).toEqual([{ slug: id('category') }])
    expect((await rest(`tags?select=slug&slug=eq.${id('tag')}`)).body).toEqual([{ slug: id('tag') }])
  })

  it('team cards are no longer readable directly; the site serves the roster through Prisma', async () => {
    expect(mine(ids(await rest('team_members?select=id')))).toEqual([])
    expect((await rest('team_members?select=email&limit=1')).body).toMatchObject({ code: '42501' })
  })

  it('every server-only table stays closed to anon and to a self-registered user', async () => {
    const token = await selfRegisteredToken()
    for (const table of SERVER_ONLY_TABLES) {
      for (const auth of [undefined, token]) {
        const result = await rest(`${table}?select=*&limit=1`, { token: auth })
        expect(result.body, `${table} as ${auth ? 'authenticated' : 'anon'}`).toMatchObject({ code: '42501' })
      }
    }
  })

  it('Storage: no client uploads or listing; public image URLs and the server upload path still work', async () => {
    const token = await selfRegisteredToken()
    for (const bucket of ['article-images', 'avatars']) {
      const response = await uploadAs(token, bucket, `probe/${id(bucket)}.png`, 'image/png', PNG_BYTES)
      expect(response.status, bucket).toBe(400)
      expect(await response.json()).toMatchObject({ statusCode: '403' })
    }
    expect(await listArticleImages()).toEqual([])
    expect(await listArticleImages(token)).toEqual([])

    const publicUrl = serviceStorage().from('article-images').getPublicUrl(DRAFT_IMAGE).data.publicUrl
    expect(publicUrl.startsWith(env.apiUrl)).toBe(true)
    const image = await fetch(publicUrl)
    expect(image.status).toBe(200)
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG_BYTES)

    const name = `articles/${id('server-upload')}.png`
    const uploaded = await serviceStorage().from('article-images').upload(name, PNG_BYTES, { contentType: 'image/png' })
    expect(uploaded.error).toBeNull()
    const removed = await serviceStorage().from('article-images').remove([name])
    expect(removed.error).toBeNull()
    expect(removed.data).toHaveLength(1)
  })

  it('the server role (postgres, used by Prisma) still reads and writes everything it did before', async () => {
    const all = await db.query(`SELECT count(*)::int AS n FROM articles WHERE id LIKE $1`, [`%-${run}`])
    expect(all.rows[0].n).toBe(5)
    const team = await db.query(`SELECT count(*)::int AS n FROM team_members WHERE id LIKE $1`, [`%-${run}`])
    expect(team.rows[0].n).toBe(2)
    await db.query(`UPDATE articles SET "deletedAt" = NULL WHERE id = $1`, [id('trashed')])
    expect(mine(ids(await rest('articles?select=id')))).toEqual([id('trashed'), id('visible')])
    await db.query(`UPDATE articles SET "deletedAt" = now() WHERE id = $1`, [id('trashed')])
  })

  it('display-title validation keeps its behaviour and constraint, with a pinned search path', async () => {
    const fn = await db.query(`SELECT proconfig, prosecdef FROM pg_proc WHERE oid = 'public.users_display_titles_valid(text[])'::regprocedure`)
    expect(fn.rows).toEqual([{ proconfig: ['search_path=pg_catalog'], prosecdef: false }])
    const checks = await db.query(`SELECT
        public.users_display_titles_valid(ARRAY['Writer']) AS valid,
        public.users_display_titles_valid(ARRAY['Writer','Writer']) AS duplicate,
        public.users_display_titles_valid(ARRAY['Invented']) AS invalid,
        public.users_display_titles_valid(NULL) AS missing`)
    expect(checks.rows).toEqual([{ valid: true, duplicate: false, invalid: false, missing: false }])
    await db.query(`UPDATE users SET "displayTitles" = ARRAY['Writer'] WHERE id = $1`, [id('author')])
    await expect(db.query(`UPDATE users SET "displayTitles" = ARRAY['Invented'] WHERE id = $1`, [id('author')]))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('leaves the corrections protection and hidden-debate guards in place', async () => {
    const triggers = await db.query(`SELECT tgname FROM pg_trigger
      WHERE tgname IN ('article_corrections_protect','articles_hidden_debate_guard','articles_clear_hidden_by_debate')
        AND tgenabled = 'O' ORDER BY 1`)
    expect(triggers.rows.map((r) => r.tgname)).toEqual(
      ['article_corrections_protect', 'articles_clear_hidden_by_debate', 'articles_hidden_debate_guard'])
  })
})
