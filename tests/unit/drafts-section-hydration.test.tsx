// @vitest-environment jsdom
/**
 * "saved 2 minutes ago" is rendered on the server and again when the dashboard hydrates. When the two straddle a
 * boundary of the relative wording (a slow device, a loaded CI runner), the texts differ and React reports a
 * hydration error (#418). Seen in the Testing Mode scenarios E2E under CPU load (PR #131 investigation).
 */
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { DraftsSection } from '@/components/editorial/DraftsSection'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('a draft saved a few minutes ago hydrates without a mismatch when the minute rolls over in between', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] })
  const serverTime = new Date('2026-10-14T12:00:00Z')
  const draft = { id: 'd1', title: 'Representative draft', updatedAt: new Date(serverTime.getTime() - 140_000).toISOString(), wordCount: 3, category: null }
  const view = <DraftsSection drafts={[draft]} />

  vi.setSystemTime(serverTime)
  const host = document.createElement('div'); document.body.append(host)
  host.innerHTML = renderToString(view)
  expect(host.textContent).toContain('saved 2 minutes ago')

  vi.setSystemTime(new Date(serverTime.getTime() + 20_000)) // the client hydrates 20 s later: now "3 minutes ago"
  const errors: unknown[][] = []
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
  const recoverable: Error[] = []
  let root!: ReturnType<typeof hydrateRoot>
  await act(async () => { root = hydrateRoot(host, view, { onRecoverableError: (error) => recoverable.push(error as Error) }) })
  try {
    expect(recoverable).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
