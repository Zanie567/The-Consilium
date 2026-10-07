import { describe, expect, it, vi } from 'vitest'
import { identityPinnedFetch } from '@/lib/testingClient'

const origin = 'http://localhost:3340'
const identity = 'real-admin:2:test-session'
const transport = () => vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))

describe('testing identity transport boundary', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('preserves %s framework request and options by reference', async method => {
    const original = transport()
    const controller = new AbortController()
    const request = new Request(`${origin}/editorial?_rsc=route`, { method, signal: controller.signal })
    const options = { cache: 'no-store' as const, signal: controller.signal }
    await identityPinnedFetch(original, identity, origin)(request, options)
    expect(original.mock.calls[0][0]).toBe(request)
    expect(original.mock.calls[0][1]).toBe(options)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
  })

  it('pins an API write while preserving its body, credentials and abort propagation', async () => {
    const original = transport()
    const controller = new AbortController()
    const request = new Request(`${origin}/api/articles`, { method: 'POST', body: '{"title":"draft"}', credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-consilium-identity': 'forged' } })
    await identityPinnedFetch(original, identity, origin)(request)
    const sent = original.mock.calls[0][0] as Request
    expect(sent.headers.get('x-consilium-identity')).toBe(identity)
    expect(sent.headers.get('Content-Type')).toBe('application/json')
    expect(sent.credentials).toBe('include')
    expect(await sent.text()).toBe('{"title":"draft"}')
    controller.abort()
    expect(sent.signal.aborted).toBe(true)
  })

  it('leaves authentication, persona transitions, foreign services and anonymous writes untouched', async () => {
    const original = transport()
    for (const url of [`${origin}/api/auth/signout`, `${origin}/api/testing-session`, 'http://localhost:55423/storage/v1/object/avatars/photo']) {
      const request = new Request(url, { method: 'POST', body: 'body' })
      await identityPinnedFetch(original, identity, origin)(request)
      expect(original.mock.calls.at(-1)?.[0]).toBe(request)
      expect(request.headers.has('x-consilium-identity')).toBe(false)
    }
    const request = new Request(`${origin}/api/articles`, { method: 'POST' })
    await identityPinnedFetch(original, undefined, origin)(request)
    expect(original.mock.calls.at(-1)?.[0]).toBe(request)
  })
})
