import { expect, type APIRequestContext } from '@playwright/test'

export type SessionBody = { requestIdentity?: string; user?: { id?: string; role?: string } }

/**
 * Reads the current session through an APIRequestContext. It is an idempotent GET, so Playwright's built-in
 * `maxRetries: 1` is allowed: it retries ONLY a connection reset (ECONNRESET, "socket hang up", e.g. a keep-alive socket
 * the server closed while idle), never an HTTP status, and rethrows when the retry fails too. Anything other than a
 * 200 still fails here, so a 401/403/500 or a persistent transport failure is never hidden.
 */
export async function readSession(request: APIRequestContext): Promise<SessionBody> {
  const response = await request.get('/api/auth/session', { maxRetries: 1 })
  expect(response.status(), 'GET /api/auth/session').toBe(200)
  return (await response.json()) as SessionBody
}
