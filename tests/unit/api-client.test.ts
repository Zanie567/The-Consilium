import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/lib/apiClient'

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('safely parses successful JSON and plain-text responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: 'article-1' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest<{ id: string }>('/api/article')).resolves.toEqual({ id: 'article-1' })
    await expect(apiRequest<string>('/api/text')).resolves.toBe('ok')
  })

  it.each([
    [401, 'auth'],
    [403, 'permission'],
    [400, 'validation'],
    [422, 'validation'],
    [409, 'conflict'],
    [500, 'server'],
    [503, 'server'],
    [418, 'http'],
  ] as const)('maps HTTP %s to a %s error', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { error: 'Request rejected' })))

    await expect(apiRequest('/api/article')).rejects.toMatchObject({ kind, status })
  })

  it('keeps the route\'s own 401 wording, so "sign in" and "session expired" stay distinct', async () => {
    // A 401 is as often "you were never signed in" as "your session expired",
    // and only the route knows which. Assuming the latter told a logged-out
    // reader their session had expired.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: 'You need to sign in to continue.', code: 'AUTH_REQUIRED' }),
      ),
    )

    await expect(apiRequest('/api/comments')).rejects.toMatchObject({
      kind: 'auth',
      message: 'You need to sign in to continue.',
    })
  })

  it('falls back to wording true of both cases when a 401 says nothing useful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' })))

    await expect(apiRequest('/api/comments')).rejects.toMatchObject({
      kind: 'auth',
      message: 'You need to sign in to continue.',
    })
  })

  it('distinguishes a reported database schema mismatch from other server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: 'The database schema is out of date.',
          code: 'SCHEMA_MISMATCH',
        }),
      ),
    )

    await expect(apiRequest('/api/article')).rejects.toMatchObject({
      kind: 'schema',
      status: 503,
      code: 'SCHEMA_MISMATCH',
    })
  })

  it('preserves useful validation details and a server request reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          422,
          { error: 'The slug is already in use.', code: 'INVALID_SLUG' },
          { 'x-request-id': 'request-123' },
        ),
      ),
    )

    await expect(apiRequest('/api/article')).rejects.toMatchObject({
      kind: 'validation',
      message: 'The slug is already in use.',
      code: 'INVALID_SLUG',
      requestId: 'request-123',
    })
  })

  it('does not expose a non-JSON infrastructure error page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>private proxy detail</html>', { status: 502 })),
    )

    const request = apiRequest('/api/article')
    await expect(request).rejects.toMatchObject({ kind: 'server', status: 502 })
    await expect(request).rejects.not.toMatchObject({ message: expect.stringContaining('private proxy detail') })
  })

  it('classifies a timed-out request and aborts the underlying fetch', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/api/article', {}, { timeoutMs: 5 })).rejects.toMatchObject({
      kind: 'timeout',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies a network failure and never retries the mutation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      apiRequest('/api/article', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ kind: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
