/**
 * Data API permission inventory after a full rebuild: Supabase's own defaults, `prisma db push` as
 * postgres, then EVERY file in supabase/migrations. This is what any new environment (or a disaster
 * recovery rebuild) gets, and what production converges to once the pending migrations are applied.
 *
 * It fails when a change would expose data through the Data API (PostgREST) or Storage to the public
 * anon key or to a self-registered Supabase Auth user, and when a change would break the access the
 * site itself relies on (Prisma's role, the Storage service role, public reads). All rows are synthetic.
 *
 * The site uses no Data API table, view or function: Prisma reads and writes everything, and the
 * service role is used only for Storage. The anon read policies below cover public content only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { PUBLIC_ARTICLE_SELECT } from '@/lib/publicArticle'
import { PNG_BYTES, connectAsPostgres, env, rest, selfRegisteredToken, serviceStorage, storageRequest } from './helpers'

/** Columns anon may SELECT, per table (20260408000100_restrict_column_grants.sql). */
const ANON_COLUMNS: Record<string, string[]> = {
  article_tags: ['articleId', 'tagId'],
  articles: Object.keys(PUBLIC_ARTICLE_SELECT),
  categories: ['createdAt', 'id', 'name', 'slug'],
  series: ['createdAt', 'description', 'id', 'slug', 'title'],
  tags: ['createdAt', 'id', 'name', 'slug'],
  team_members: ['bio', 'id', 'image', 'isActive', 'name', 'order', 'role'],
}
/** Tables anon may query: exactly the granted ones. RLS then filters rows (team_members to none). */
const ANON_QUERYABLE = Object.keys(ANON_COLUMNS).sort()

/** Every policy that applies to an API role, with its exact predicate. */
const API_POLICIES = [
  'article_tags|anon_read_published_article_tags|SELECT|{anon}|(EXISTS ( SELECT 1 FROM articles WHERE ((articles.id = article_tags."articleId") AND (articles.status = \'PUBLISHED\'::"ArticleStatus"))))',
  'articles|anon_read_published_articles|SELECT|{anon}|((status = \'PUBLISHED\'::"ArticleStatus") AND ("deletedAt" IS NULL) AND ("hiddenByDebateAt" IS NULL))',
  'categories|anon_read_categories|SELECT|{anon}|true',
  'series|anon_read_series|SELECT|{anon}|true',
  'tags|anon_read_tags|SELECT|{anon}|true',
  'team_members|anon_read_team_members|SELECT|{anon}|false',
  'users|users_no_client_writes|ALL|{anon,authenticated}|false',
]

const run = randomUUID().replaceAll('-', '').slice(0, 10)
let db: Client
/** PostgREST reloads its schema cache asynchronously after DDL; wait until it knows the table. */
async function untilCached(path: string) {
  for (let i = 0; i < 50; i++) {
    const result = await rest(path)
    if ((result.body as { code?: string } | null)?.code !== 'PGRST205' && (result.body as { code?: string } | null)?.code !== 'PGRST202') return
    await db.query(`NOTIFY pgrst, 'reload schema'`)
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`PostgREST never loaded ${path}`)
}
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[]

beforeAll(async () => { db = await connectAsPostgres() })
afterAll(async () => { await db?.end() })

describe.sequential('Data API permission inventory after a full rebuild from the repository', () => {
  it('every table, view, sequence and function in public is owned by postgres', async () => {
    // Objects owned by supabase_admin would inherit its default privileges, which grant everything to
    // anon and authenticated and which postgres cannot change.
    expect(await rows(`SELECT relname, pg_get_userbyid(relowner) AS owner FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m','S','f') AND relowner <> 'postgres'::regrole`)).toEqual([])
    expect(await rows(`SELECT proname, pg_get_userbyid(proowner) AS owner FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proowner <> 'postgres'::regrole`)).toEqual([])
  })

  it('row-level security is enabled on every table', async () => {
    expect(await rows(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relkind IN ('r','p') AND NOT relrowsecurity`)).toEqual([])
  })

  it('the API roles hold no table-level privilege, and only the reviewed anon column allowlist', async () => {
    expect(await rows(`SELECT c.relname, a.grantee::regrole::text AS role, a.privilege_type FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
        AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid)`)).toEqual([])
    const columns = await rows<{ relname: string; role: string; cols: string[] }>(`SELECT c.relname, x.grantee::regrole::text AS role,
        array_agg(a.attname::text ORDER BY a.attname) AS cols
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid, aclexplode(a.attacl) x
      WHERE c.relnamespace = 'public'::regnamespace AND x.grantee IN ('anon'::regrole, 'authenticated'::regrole, 0::oid)
      GROUP BY 1, 2 ORDER BY 1, 2`)
    expect(columns.map((c) => c.role)).toEqual(Object.keys(ANON_COLUMNS).map(() => 'anon'))
    expect(Object.fromEntries(columns.map((c) => [c.relname, c.cols]))).toEqual(
      Object.fromEntries(Object.entries(ANON_COLUMNS).map(([t, cols]) => [t, [...cols].sort()])))
  })

  it('the only policies that apply to API roles are the reviewed ones, word for word', async () => {
    const policies = await rows<{ p: string }>(`SELECT tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' ||
        regexp_replace(coalesce(qual, with_check, ''), '\\s+', ' ', 'g') AS p
      FROM pg_policies WHERE schemaname = 'public'
        AND roles && ARRAY['anon', 'authenticated', 'public']::name[] ORDER BY 1`)
    expect(policies.map((r) => r.p)).toEqual(API_POLICIES)
    expect(await rows(`SELECT policyname FROM pg_policies WHERE schemaname = 'storage'
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]`)).toEqual([])
  })

  it('no function or sequence in public is usable by the API roles; definer functions pin their search path', async () => {
    expect(await rows(`SELECT p.oid::regprocedure::text AS fn FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`)).toEqual([])
    expect(await rows(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S'
      AND CASE WHEN relkind = 'S' THEN has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE')
                                    OR has_sequence_privilege('authenticated', oid, 'USAGE,SELECT,UPDATE') END`)).toEqual([])
    expect(await rows(`SELECT p.oid::regprocedure::text AS fn FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')`)).toEqual([])
  })

  it("postgres's default privileges give new tables, functions and sequences nothing for the API roles", async () => {
    const defaults = await rows<{ type: string; schema: string | null; acl: string }>(`SELECT d.defaclobjtype::text AS type,
        n.nspname AS schema, d.defaclacl::text AS acl
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE d.defaclrole = 'postgres'::regrole AND (n.nspname = 'public' OR d.defaclnamespace = 0)`)
    for (const d of defaults) {
      expect(d.acl, `${d.schema ?? 'global'} ${d.type}`).not.toMatch(/(^|[{,])(anon|authenticated)=/)
      if (d.type === 'f' && d.schema === null) expect(d.acl, 'global function default').not.toMatch(/(^|[{,])=X/)
    }
    // The global PUBLIC EXECUTE default is removed only by an explicit global entry.
    expect(defaults.some((d) => d.type === 'f' && d.schema === null)).toBe(true)
  })

  it('over HTTP, anon may query only the granted public-content tables; a self-registered user none', async () => {
    const token = await selfRegisteredToken()
    const tables = (await rows<{ relname: string }>(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
      AND relkind IN ('r','p','v','m') ORDER BY 1`)).map((r) => r.relname)
    expect(tables.length).toBeGreaterThan(30)
    const queryable: Record<string, string[]> = { anon: [], authenticated: [] }
    for (const table of tables) {
      for (const [role, auth] of [['anon', undefined], ['authenticated', token]] as const) {
        const result = await rest(`${encodeURIComponent(table)}?select=*&limit=1`, { token: auth })
        const columns = await rest(`${encodeURIComponent(table)}?limit=1&select=${(ANON_COLUMNS[table] ?? ['id']).map((c) => `"${c}"`).join(',')}`, { token: auth })
        if (result.status === 200 || columns.status === 200) queryable[role].push(table)
      }
    }
    expect(queryable).toEqual({ anon: ANON_QUERYABLE, authenticated: [] })
    // Rows: a team card and a trashed article exist, yet anon sees neither.
    const card = `card-${run}`, author = `author-${run}`, trashed = `trashed-${run}`
    await db.query(`INSERT INTO team_members (id, name, role, "isActive", "updatedAt") VALUES ($1, 'Card', 'Editor', true, now())`, [card])
    await db.query(`INSERT INTO users (id, email, "updatedAt") VALUES ($1, $2, now())`, [author, `${author}@example.test`])
    await db.query(`INSERT INTO articles (id, title, slug, content, "authorId", status, "deletedAt", "updatedAt")
      VALUES ($1, $1, $1, 'synthetic', $2, 'PUBLISHED', now(), now())`, [trashed, author])
    try {
      expect((await rest(`team_members?select=id&id=eq.${card}`)).body).toEqual([])
      expect((await rest(`articles?select=id&id=eq.${trashed}`)).body).toEqual([])
    } finally {
      await db.query(`DELETE FROM articles WHERE id = $1`, [trashed])
      await db.query(`DELETE FROM users WHERE id = $1`, [author])
      await db.query(`DELETE FROM team_members WHERE id = $1`, [card])
    }
  })

  it('functions are not callable through /rpc by anon or a self-registered user', async () => {
    const token = await selfRegisteredToken()
    const fns = (await rows<{ proname: string }>(`SELECT DISTINCT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`))
      .map((r) => r.proname)
    expect(fns).toEqual(expect.arrayContaining(['users_display_titles_valid', 'consilium_tag_identity', 'invoke_publish_scheduled']))
    for (const fn of fns) {
      for (const auth of [undefined, token]) {
        const result = await rest(`rpc/${fn}`, { method: 'POST', body: '{}', token: auth })
        expect(result.status, `${fn} as ${auth ? 'authenticated' : 'anon'}`).not.toBe(200)
        expect(result.status).not.toBe(204)
      }
    }
    // Specifically: a call that would succeed with EXECUTE is refused for lack of it.
    const call = await rest('rpc/users_display_titles_valid', { method: 'POST', body: JSON.stringify({ titles: ['Writer'] }) })
    expect(call.body).toMatchObject({ code: '42501' })
  })

  it('a future table, function or sequence created by postgres starts private to the Data API', async () => {
    const t = `future_${run}`
    await db.query(`CREATE TABLE public.${t} (id serial PRIMARY KEY, secret text);
      INSERT INTO public.${t} (secret) VALUES ('synthetic');
      CREATE FUNCTION public.${t}_fn() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 'definer' $$;
      CREATE SEQUENCE public.${t}_seq;`)
    try {
      await untilCached(`${t}?select=id`)
      await untilCached(`rpc/${t}_fn`)
      // RLS is off on purpose: grants alone must keep it private, as the 30 October change intends.
      expect((await rest(`${t}?select=*`)).body).toMatchObject({ code: '42501' })
      expect((await rest(`${t}?select=*`, { token: await selfRegisteredToken() })).body).toMatchObject({ code: '42501' })
      expect((await rest(`rpc/${t}_fn`, { method: 'POST', body: '{}' })).body).toMatchObject({ code: '42501' })
      expect(await rows(`SELECT has_sequence_privilege('anon', 'public.${t}_seq', 'USAGE') AS anon,
        has_sequence_privilege('anon', 'public.${t}_id_seq', 'USAGE') AS serial`)).toEqual([{ anon: false, serial: false }])
      // The owner (Prisma's role) keeps full access.
      expect(await rows(`SELECT secret FROM public.${t}`)).toEqual([{ secret: 'synthetic' }])
      expect(await rows(`SELECT public.${t}_fn() AS v`)).toEqual([{ v: 'definer' }])
    } finally {
      await db.query(`DROP TABLE public.${t}; DROP FUNCTION public.${t}_fn(); DROP SEQUENCE public.${t}_seq;`)
    }
  })

  it("after Supabase's 30 October change, new tables also lose service_role, and the site is unaffected", async () => {
    const t = `after_change_${run}`
    // What Supabase applies to existing projects on 2026-10-30 (Discussion #45329).
    await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM service_role;`)
    try {
      await db.query(`CREATE TABLE public.${t} (id serial PRIMARY KEY, label text); ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
      await db.query(`INSERT INTO public.${t} (label) VALUES ('written by the owner, as Prisma does')`)
      await untilCached(`${t}?select=id`)
      expect(await rows(`SELECT label FROM public.${t}`)).toEqual([{ label: 'written by the owner, as Prisma does' }])
      const asService = await rest(`${t}?select=*`, { headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` } })
      expect(asService.body).toMatchObject({ code: '42501' })
      // Existing tables keep their grants, and Storage (the only service-role use) still works.
      const tags = await rest('tags?select=id&limit=1', { headers: { apikey: env.serviceKey, authorization: `Bearer ${env.serviceKey}` } })
      expect(tags.status).toBe(200)
      const name = `articles/${t}.png`
      expect((await serviceStorage().from('article-images').upload(name, PNG_BYTES, { contentType: 'image/png' })).error).toBeNull()
      expect((await serviceStorage().from('article-images').remove([name])).error).toBeNull()
    } finally {
      await db.query(`DROP TABLE IF EXISTS public.${t};
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;`)
    }
  })

  it('the site keeps working: owner writes through the CHECK and identity indexes; service role keeps EXECUTE', async () => {
    const user = `inv-${run}`
    await db.query(`INSERT INTO users (id, email, "displayTitles", "updatedAt") VALUES ($1, $2, ARRAY['Writer'], now())`, [user, `${user}@example.test`])
    await expect(db.query(`UPDATE users SET "displayTitles" = ARRAY['Invented'] WHERE id = $1`, [user])).rejects.toMatchObject({ code: '23514' })
    await db.query(`INSERT INTO tags (id, name, slug) VALUES ($1, $2, $1)`, [`tag-${run}`, `Inventory Topic ${run}`])
    await expect(db.query(`INSERT INTO tags (id, name, slug) VALUES ($1, $2, $1)`, [`tag2-${run}`, `inventory   topic ${run}`]))
      .rejects.toMatchObject({ code: '23505' }) // the identity index still evaluates its function
    expect(await rows(`SELECT has_function_privilege('service_role', 'public.consilium_tag_identity(text)', 'EXECUTE') AS service,
      has_function_privilege('postgres', 'public.users_display_titles_valid(text[])', 'EXECUTE') AS owner`)).toEqual([{ service: true, owner: true }])
    await db.query(`DELETE FROM tags WHERE id = $1`, [`tag-${run}`])
    await db.query(`DELETE FROM users WHERE id = $1`, [user])
  })

  it('Storage: public URLs serve, clients cannot upload or list, the server role can', async () => {
    const name = `articles/inventory-${run}.png`
    expect((await serviceStorage().from('article-images').upload(name, PNG_BYTES, { contentType: 'image/png' })).error).toBeNull()
    try {
      expect((await fetch(serviceStorage().from('article-images').getPublicUrl(name).data.publicUrl)).status).toBe(200)
      const token = await selfRegisteredToken()
      for (const bucket of ['article-images', 'avatars']) {
        const upload = await storageRequest(`object/${bucket}/probe-${run}.png`, { method: 'POST', token, headers: { 'content-type': 'image/png' }, body: PNG_BYTES })
        expect(upload.status, bucket).toBe(400)
        const list = await storageRequest(`object/list/${bucket}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix: '' }) })
        expect(await list.json(), bucket).toEqual([])
      }
    } finally {
      await serviceStorage().from('article-images').remove([name])
    }
  })
})
