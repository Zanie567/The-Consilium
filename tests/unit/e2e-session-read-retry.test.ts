import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { request, type APIRequestContext } from '@playwright/test'
import { readSession } from '../e2e/helpers/session'

// readSession may retry a connection reset ONCE and nothing else. A real local server drives Playwright's own retry.
type Behaviour = 'ok' | 'reset' | 'status500' | 'status401' | 'status403'
let server: http.Server
let context: APIRequestContext

async function start(plan: Behaviour[]) {
  const hits = { count: 0 }
  server = http.createServer((req, res) => {
    const step = plan[Math.min(hits.count++, plan.length - 1)]
    if (step === 'reset') return void req.socket.destroy()
    res.statusCode = step === 'ok' ? 200 : Number(step.replace('status', ''))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ requestIdentity: 'id-1', user: { id: 'u1' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context = await request.newContext({ baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
  return hits
}

afterEach(async () => {
  await context?.dispose()
  await new Promise((resolve) => server?.close(resolve))
})

describe('readSession', () => {
  it('returns the session when the first attempt was reset and the one retry succeeds', async () => {
    const hits = await start(['reset', 'ok'])
    expect((await readSession(context)).requestIdentity).toBe('id-1')
    expect(hits.count).toBe(2)
  })

  it('retries exactly once: a second reset surfaces as an error', async () => {
    const hits = await start(['reset'])
    await expect(readSession(context)).rejects.toThrow(/socket hang up|ECONNRESET/)
    expect(hits.count).toBe(2)
  })

  it.each(['status500', 'status401', 'status403'] as const)('never retries or hides an HTTP failure: %s', async (step) => {
    const hits = await start([step, 'ok'])
    await expect(readSession(context)).rejects.toThrow()
    expect(hits.count).toBe(1)
  })

  it('does not retry when the first attempt works', async () => {
    const hits = await start(['ok'])
    await readSession(context)
    expect(hits.count).toBe(1)
  })
})
