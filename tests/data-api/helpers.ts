import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// Set by scripts/db/data-api-harness.sh; vitest.data-api.config.ts has already refused
// anything that is not a loopback address.
export const env = {
  dbUrl: process.env.DATA_API_DB_URL!,
  apiUrl: process.env.DATA_API_URL!,
  anonKey: process.env.DATA_API_ANON_KEY!,
  serviceKey: process.env.DATA_API_SERVICE_ROLE_KEY!,
}

/** A connection as `postgres`: the role Prisma uses on production (BYPASSRLS, not superuser). */
export async function connectAsPostgres(): Promise<Client> {
  const client = new Client({ connectionString: env.dbUrl })
  await client.connect()
  return client
}

/** The server's Storage client (service role), as src/app/api/upload/route.ts creates it. */
export const serviceStorage = () => createClient(env.apiUrl, env.serviceKey).storage

type Rest = { status: number; body: unknown }

/** A PostgREST call with the public anon key, optionally as a signed-in Supabase Auth user. */
export async function rest(path: string, init: RequestInit & { token?: string } = {}): Promise<Rest> {
  const { token, headers, ...rest } = init
  const response = await fetch(`${env.apiUrl}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${token ?? env.anonKey}`,
      'content-type': 'application/json',
      ...headers,
    },
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

/** Rows a PostgREST read returned, or the error it answered with. */
export const ids = (result: Rest) =>
  Array.isArray(result.body) ? (result.body as { id: string }[]).map((row) => row.id).sort() : result

export async function storageRequest(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, headers, ...rest } = init
  return fetch(`${env.apiUrl}/storage/v1/${path}`, {
    ...rest,
    headers: { apikey: env.anonKey, authorization: `Bearer ${token ?? env.anonKey}`, ...headers },
  })
}

/**
 * What anyone could do with the public anon key if Supabase Auth sign-ups are enabled:
 * register and receive an `authenticated` JWT. The app never uses Supabase Auth.
 */
export async function selfRegisteredToken(): Promise<string> {
  const response = await fetch(`${env.apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `probe-${randomUUID()}@example.test`, password: `Probe-${randomUUID()}` }),
  })
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`sign-up did not return a session (HTTP ${response.status})`)
  return body.access_token
}

export const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex')
