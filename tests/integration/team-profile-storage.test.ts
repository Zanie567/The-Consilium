/**
 * Photo storage behaviour with the REAL supabase-js client and the REAL route,
 * talking to a local server that speaks the Supabase Storage wire contract
 * (tests/e2e/helpers/fake-storage-server.ts). Nothing is mocked except next-auth.
 *
 * Bucket rules (existence, public, size cap, allowed types) come from the
 * `storage.buckets` table of the local test database — populated here by running
 * the project's actual migration — so this also verifies what the migration creates.
 *
 * This is NOT real Supabase Storage (see the fake's header for what it does not
 * model). Missing required local database/schema fails collection.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient, type Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

const TEST_DB = process.env.TEST_DATABASE_URL!
const PORT = 54000 + Math.floor(Math.random() * 900)
const STORAGE = `http://127.0.0.1:${PORT}`

async function ready(): Promise<boolean> {
  assertSafeTestDatabaseHost(TEST_DB, 'TEST_DATABASE_URL')
  const client = new Client({ connectionString: TEST_DB, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    const { rowCount } = await client.query(
      `select 1 from information_schema.columns where table_name = 'team_members' and column_name = 'userId'`,
    )
    return rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const isReady = await ready()
if (!isReady) throw new Error('Required local test database with team_members.userId is not ready')
const suite = describe

const { state } = vi.hoisted(() => ({
  state: { prisma: undefined as unknown, session: null as null | { id: string } },
}))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return state.prisma
  },
}))
vi.mock('@/lib/auth', () => ({
  requireVerifiedSessionUser: async (allowed?: readonly Role[]) => {
    const db = state.prisma as PrismaClient
    if (!state.session) return { ok: false, response: NextResponse.json({ error: 'sign in' }, { status: 401 }) }
    const user = await db.user.findUnique({ where: { id: state.session.id } })
    if (!user) return { ok: false, response: NextResponse.json({ error: 'gone' }, { status: 401 }) }
    if (allowed && !allowed.includes(user.role)) return { ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) }
    return { ok: true, user: { id: user.id, role: user.role, name: user.name, email: user.email } }
  },
}))

import { PUT } from '@/app/api/team-profile/route'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6])
const png = (extra = 0, name = 'p.png') => {
  const bytes = new Uint8Array(PNG.length + extra)
  bytes.set(PNG)
  return new File([bytes as BlobPart], name, { type: 'image/png' })
}

let db: PrismaClient
let server: ChildProcess
const tag = `tps-${Date.now()}`

const objects = async (): Promise<{ key: string; type: string; size: number }[]> =>
  (await fetch(`${STORAGE}/__objects`)).json()
const mine = async (userId: string) => (await objects()).filter((o) => o.key.startsWith(`avatars/${userId}/`))

function put(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return PUT(new NextRequest('http://localhost/api/team-profile', { method: 'PUT', body: form }))
}
const user = (role: Role, label: string) =>
  db.user.create({ data: { email: `${tag}-${label}@ed.ac.uk`, name: `Storage ${label}`, role } })

suite('team photo storage (real client, local storage server)', () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DB }) })
    state.prisma = db

    // Build the storage schema and run the PROJECT'S migration, exactly as it would be run.
    const pg = new Client({ connectionString: TEST_DB })
    await pg.connect()
    await pg.query(readFileSync(resolve(__dirname, '../e2e/helpers/local-storage-schema.sql'), 'utf8'))
    await pg.query(readFileSync(resolve(__dirname, '../../supabase/migrations/20261001_team_member_user_link.sql'), 'utf8'))
    await pg.end()

    server = spawn('npx', ['ts-node', '-P', 'tsconfig.seed.json', resolve(__dirname, '../e2e/helpers/fake-storage-server.ts')], {
      env: { ...process.env, FAKE_STORAGE_PORT: String(PORT) },
      stdio: 'ignore',
    })
    for (let i = 0; i < 200; i++) {
      try {
        await fetch(`${STORAGE}/__objects`)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = STORAGE
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-service-key'
  })

  beforeEach(async () => {
    state.session = null
    await fetch(`${STORAGE}/__reset`, { method: 'POST' })
  })

  afterAll(async () => {
    server?.kill()
    await db.teamMember.deleteMany({ where: { user: { email: { startsWith: tag } } } })
    await db.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db.$disconnect()
  })

  it('the migration created a public avatars bucket with a size cap and image-only types', async () => {
    const pg = new Client({ connectionString: TEST_DB })
    await pg.connect()
    const { rows } = await pg.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'`)
    await pg.end()
    expect(rows).toHaveLength(1)
    expect(rows[0].public).toBe(true)
    expect(Number(rows[0].file_size_limit)).toBe(5 * 1024 * 1024)
    expect(rows[0].allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
  })

  it('a valid upload is stored in the caller’s folder and is retrievable by its public URL', async () => {
    const u = await user('WRITER', 'valid')
    state.session = { id: u.id }
    const res = await put({ bio: 'hi', image: png() })
    expect(res.status).toBe(201)
    const { image } = await res.json()

    expect(image).toMatch(new RegExp(`^${STORAGE}/storage/v1/object/public/avatars/${u.id}/team-.*\\.png$`))
    const served = await fetch(image)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)
  })

  it('replacing deletes the old file only after the new one is stored', async () => {
    const u = await user('WRITER', 'replace')
    state.session = { id: u.id }
    const first = (await (await put({ image: png() })).json()).image as string
    const second = (await (await put({ image: png(3, 'b.png') })).json()).image as string

    expect(second).not.toBe(first)
    expect((await fetch(first)).status).toBe(404)
    expect((await fetch(second)).status).toBe(200)
    expect(await mine(u.id)).toHaveLength(1)
  })

  it('removing clears the column and deletes the file', async () => {
    const u = await user('WRITER', 'remove')
    state.session = { id: u.id }
    const { image } = await (await put({ image: png() })).json()
    expect((await put({ removeImage: 'true' })).status).toBe(200)
    expect((await db.teamMember.findUniqueOrThrow({ where: { userId: u.id } })).image).toBeNull()
    expect((await fetch(image)).status).toBe(404)
    expect(await mine(u.id)).toHaveLength(0)
  })

  it('rejects non-images by their bytes, even with an image name and declared type', async () => {
    const u = await user('WRITER', 'magic')
    state.session = { id: u.id }
    const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')], 'a.png', { type: 'image/png' })
    expect((await put({ image: svg })).status).toBe(400)
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0])], 'a.jpg', { type: 'image/jpeg' })
    expect((await put({ image: exe })).status).toBe(400)
    expect(await objects()).toHaveLength(0)
  })

  it('rejects an image over 4 MB in the route, before it is uploaded', async () => {
    const u = await user('WRITER', 'big')
    state.session = { id: u.id }
    expect((await put({ image: png(4 * 1024 * 1024) })).status).toBe(400)
    expect(await objects()).toHaveLength(0)
  })

  it('the bucket itself also enforces its limits if the route were bypassed', async () => {
    const send = (type: string, size: number) =>
      fetch(`${STORAGE}/storage/v1/object/avatars/direct/${Math.random()}.bin`, {
        method: 'POST',
        headers: { authorization: 'Bearer x', 'content-type': type, 'x-upsert': 'false' },
        body: new Uint8Array(size),
      })
    expect((await send('image/png', 100)).status).toBe(200)
    expect((await send('image/png', 5 * 1024 * 1024 + 1)).status).toBe(413)
    expect((await send('text/html', 100)).status).toBe(415)
    expect((await send('image/svg+xml', 100)).status).toBe(415)
  })

  it('one user can never write to, replace or delete another user’s files', async () => {
    const a = await user('WRITER', 'xa')
    const b = await user('EDITOR', 'xb')
    state.session = { id: b.id }
    const bImage = (await (await put({ image: png() })).json()).image as string

    state.session = { id: a.id }
    // Posting B's id, B's file URL as `image`, or asking to remove: none reach B.
    await put({ bio: 'a', userId: b.id, image: png(), removeImage: 'true' })
    await put({ removeImage: 'true', imageUrl: bImage, path: `${b.id}/x.png` })

    expect((await fetch(bImage)).status).toBe(200)
    expect((await mine(b.id)).length).toBe(1)
    for (const o of await mine(a.id)) expect(o.key.startsWith(`avatars/${a.id}/`)).toBe(true)
    expect((await db.teamMember.findUniqueOrThrow({ where: { userId: b.id } })).image).toBe(bImage)
  })

  it('a failed database save removes the new file and keeps the old photo', async () => {
    const u = await user('WRITER', 'dbfail')
    state.session = { id: u.id }
    const old = (await (await put({ image: png() })).json()).image as string
    expect(await mine(u.id)).toHaveLength(1)

    const spy = vi.spyOn(db.teamMember, 'upsert').mockRejectedValueOnce(new Error('db down'))
    const res = await put({ bio: 'new', image: png(2, 'n.png') })
    spy.mockRestore()

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await fetch(old)).status).toBe(200) // the old photo is retained…
    expect(await mine(u.id)).toHaveLength(1) // …and the new upload was cleaned up
    expect((await db.teamMember.findUniqueOrThrow({ where: { userId: u.id } })).image).toBe(old)
  })

  it('an upload failure (bucket missing) is reported and changes nothing', async () => {
    const u = await user('WRITER', 'nobucket')
    state.session = { id: u.id }
    await put({ bio: 'keep' })
    const pg = new Client({ connectionString: TEST_DB })
    await pg.connect()
    await pg.query(`delete from storage.buckets where id = 'avatars'`)
    try {
      const res = await put({ bio: 'changed', image: png() })
      expect(res.status).toBe(502)
      expect((await db.teamMember.findUniqueOrThrow({ where: { userId: u.id } })).bio).toBe('keep')
    } finally {
      await pg.query(readFileSync(resolve(__dirname, '../../supabase/migrations/20261001_team_member_user_link.sql'), 'utf8'))
      await pg.end()
    }
  })
})
