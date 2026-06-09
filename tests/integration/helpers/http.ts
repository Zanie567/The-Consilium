/**
 * HTTP + auth helpers for the live-server integration suite.
 *
 * Node's fetch does not persist cookies, so we keep a tiny in-memory jar and
 * drive the NextAuth credentials flow (csrf → callback) by hand to obtain a
 * real session cookie. This lets the audit exercise AUTHENTICATED routes
 * (comments, bookmarks, editorial, profile…) for real rather than skipping them.
 */

export class Session {
  private jar = new Map<string, string>()
  constructor(public base: string) {}

  private absorb(res: Response) {
    // undici (Node 18+) exposes getSetCookie(); fall back to a single header.
    const cookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
    for (const c of cookies) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  get cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async get(path: string): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, { headers: this.headers() })
    this.absorb(res)
    return res
  }

  async post(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    this.absorb(res)
    return res
  }

  async patch(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...this.headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    this.absorb(res)
    return res
  }

  async del(path: string): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, { method: 'DELETE', headers: this.headers() })
    this.absorb(res)
    return res
  }

  private headers(): Record<string, string> {
    const c = this.cookieHeader
    return c ? { cookie: c } : {}
  }

  /** Authenticate via the NextAuth credentials provider; returns true on success. */
  async login(email: string, password: string): Promise<boolean> {
    const csrfRes = await this.get('/api/auth/csrf')
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
    await fetch(`${this.base}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader },
      body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
      redirect: 'manual',
    }).then((r) => this.absorb(r))
    const session = await (await this.get('/api/auth/session')).json()
    return Boolean(session?.user?.id)
  }
}

/** Quick connectivity probe used to skip the suite when no server is running. */
export async function serverUp(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/articles`, { signal: AbortSignal.timeout(4000) })
    return res.status < 600
  } catch {
    return false
  }
}
