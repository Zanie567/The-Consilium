/* eslint-disable no-console -- a standalone test server */
/**
 * A local stand-in for the Supabase Storage HTTP API, for end-to-end tests.
 *
 * Why it exists: real Supabase Storage needs Docker (supabase CLI) or a hosted
 * project, and tests must never touch production. This speaks the same wire
 * contract the real `@supabase/supabase-js` client uses, so the app's real client
 * code runs unchanged against it:
 *
 *   POST   /storage/v1/object/<bucket>/<path>          upload (409 if it exists, as x-upsert=false)
 *   DELETE /storage/v1/object/<bucket>   {prefixes[]}  remove
 *   GET    /storage/v1/object/public/<bucket>/<path>   public read (only if the bucket is public)
 *
 * Bucket rules are NOT hard-coded: they are read from the `storage.buckets` table
 * of the local test Postgres, which the project's migration populates — so the
 * migration's INSERT is what decides whether `avatars` exists, is public, and what
 * size/type limits it has. Like the real service it enforces the bucket's
 * file_size_limit (413) and allowed_mime_types against the DECLARED content type
 * (415); it does not inspect bytes. It requires a Bearer token.
 *
 * It is NOT the real service: it does not model storage RLS policies, signed URLs,
 * transformations or CDN behaviour. Inspection endpoints for tests: GET /__objects.
 */
import { assertRunDatabase } from '../../../scripts/lib/assertRunDatabase'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Client } from 'pg'
import { assertSafeTestDatabaseHost } from '../../../scripts/lib/assertSafeTestDatabaseHost'

const PORT = Number(process.env.FAKE_STORAGE_PORT ?? 54321)
const DB_URL = process.env.TEST_DATABASE_URL
if (!DB_URL) throw new Error('TEST_DATABASE_URL is required')
assertSafeTestDatabaseHost(DB_URL, 'TEST_DATABASE_URL')
assertRunDatabase()

/** key = `${bucket}/${path}` */
const objects = new Map<string, { type: string; body: Buffer }>()

async function bucketRow(id: string) {
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      'select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1',
      [id],
    )
    return rows[0] ?? null
  } finally {
    await client.end()
  }
}

function send(res: ServerResponse, status: number, body: Buffer | object, headers: Record<string, string> = {}) {
  const isBuf = Buffer.isBuffer(body)
  res.writeHead(status, { 'content-type': isBuf ? headers['content-type'] : 'application/json', ...headers })
  res.end(isBuf ? body : JSON.stringify(body))
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

      if (url.pathname === '/__attestation') {
        const client = new Client({ connectionString: DB_URL })
        try {
          await client.connect()
          const { rows } = await client.query('SELECT current_database() AS database')
          return send(res, 200, { run: process.env.E2E_RUN_ID, database: rows[0].database })
        } finally { await client.end() }
      }
      if (url.pathname === '/__objects') {
        return send(res, 200, [...objects].map(([key, o]) => ({ key, type: o.type, size: o.body.length })))
      }
      if (url.pathname === '/__reset' && req.method === 'POST') {
        objects.clear()
        return send(res, 200, { ok: true })
      }
      if (parts[0] !== 'storage' || parts[1] !== 'v1' || parts[2] !== 'object') {
        return send(res, 404, { error: 'not_found' })
      }

      // Public read: /storage/v1/object/public/<bucket>/<path>
      if (parts[3] === 'public' && req.method === 'GET') {
        const [bucket, ...rest] = parts.slice(4)
        const row = await bucketRow(bucket)
        if (!row) return send(res, 404, { error: 'Bucket not found', statusCode: '404' })
        if (!row.public) return send(res, 400, { error: 'Bucket is not public', statusCode: '400' })
        const object = objects.get(`${bucket}/${rest.join('/')}`)
        if (!object) return send(res, 404, { error: 'Object not found', statusCode: '404' })
        return send(res, 200, object.body, { 'content-type': object.type, 'cache-control': 'max-age=3600' })
      }

      if (!(req.headers.authorization ?? '').startsWith('Bearer ')) {
        return send(res, 400, { error: 'Unauthorized', message: 'missing token', statusCode: '400' })
      }

      // Upload: POST /storage/v1/object/<bucket>/<path>
      if (req.method === 'POST' || req.method === 'PUT') {
        const [bucket, ...rest] = parts.slice(3)
        const row = await bucketRow(bucket)
        if (!row) return send(res, 404, { error: 'Bucket not found', message: 'Bucket not found', statusCode: '404' })
        const key = `${bucket}/${rest.join('/')}`
        const body = await readBody(req)
        const type = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim()
        if (row.file_size_limit != null && body.length > Number(row.file_size_limit)) {
          return send(res, 413, { error: 'Payload too large', message: 'The object exceeded the maximum allowed size', statusCode: '413' })
        }
        if (row.allowed_mime_types && !row.allowed_mime_types.includes(type)) {
          return send(res, 415, { error: 'invalid_mime_type', message: `mime type ${type} is not supported`, statusCode: '415' })
        }
        if (req.method === 'POST' && req.headers['x-upsert'] !== 'true' && objects.has(key)) {
          return send(res, 409, { error: 'Duplicate', message: 'The resource already exists', statusCode: '409' })
        }
        objects.set(key, { type, body })
        return send(res, 200, { Key: key, Id: key })
      }

      // Remove: DELETE /storage/v1/object/<bucket> {prefixes}
      if (req.method === 'DELETE') {
        const bucket = parts[3]
        const { prefixes } = JSON.parse((await readBody(req)).toString() || '{}') as { prefixes?: string[] }
        const removed: { name: string; bucket_id: string }[] = []
        for (const path of prefixes ?? []) {
          if (objects.delete(`${bucket}/${path}`)) removed.push({ name: path, bucket_id: bucket })
        }
        return send(res, 200, removed)
      }
      return send(res, 405, { error: 'method_not_allowed' })
    } catch (error) {
      return send(res, 500, { error: String((error as Error)?.message) })
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake storage listening on 127.0.0.1:${PORT}`))
