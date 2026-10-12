import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import { collectConsoleErrors, isNotificationPollErrorMessage, isNotificationPollUrl } from '../e2e/helpers/console'

const URL_ = 'http://localhost:3200/api/editorial/notifications'
const MESSAGE = '/localhost:3200/api/editorial/notifications due to access control checks.'

function harness() {
  const handlers: Record<string, (value: never) => void> = {}
  const MAIN = {}
  const page = { on: (event: string, handler: (value: never) => void) => { handlers[event] = handler }, mainFrame: () => MAIN } as unknown as Page
  const errors = collectConsoleErrors(page)
  const emit = (event: string, value: unknown) => handlers[event](value as never)
  return {
    errors,
    pageError: (message = MESSAGE) => emit('pageerror', new Error(message)),
    failed: (reason: string, url = URL_, method = 'GET') => emit('requestfailed', { url: () => url, method: () => method, failure: () => ({ errorText: reason }) }),
    // Chromium: the bell's request starts, a document navigation starts, the bell's request is aborted.
    start: (url = URL_, method = 'GET') => { const request = { url: () => url, method: () => method, isNavigationRequest: () => false, frame: () => MAIN, failure: () => ({ errorText: 'net::ERR_ABORTED' }) }; emit('request', request); return request },
    navigate: (mainFrame = true) => emit('request', { url: () => 'http://localhost:3200/team', method: () => 'GET', isNavigationRequest: () => true, frame: () => (mainFrame ? MAIN : {}) }),
    abort: (request: unknown, reason = 'net::ERR_ABORTED') => emit('requestfailed', Object.assign(request as object, { failure: () => ({ errorText: reason }) })),
    responded: (status: number, url = URL_, method = 'GET') => emit('response', { url: () => url, status: () => status, request: () => ({ method: () => method }) }),
  }
}

// The collector tolerates the WebKit page error for the notification bell's fetch ONLY when the request was
// really cancelled and then really recovered. Every other outcome must stay evidence.
describe('notification poll cancellation', () => {
  it.each([
    ['page error after cancel and replacement 200', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.responded(200); h.pageError() }],
    ['page error between cancel and replacement', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.pageError(); h.responded(200) }],
    ['page error before anything else', (h: ReturnType<typeof harness>) => { h.pageError(); h.failed('Load request cancelled'); h.responded(200) }],
  ])('tolerates: %s', (_name, run) => {
    const h = harness()
    run(h)
    expect(h.errors).toEqual([])
  })

  it.each([
    ['no cancelled request seen', (h: ReturnType<typeof harness>) => { h.responded(200); h.pageError() }],
    ['cancelled but never recovered', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.pageError() }],
    ['200 only before the cancel', (h: ReturnType<typeof harness>) => { h.responded(200); h.failed('Load request cancelled'); h.pageError() }],
    ['replacement answered 500', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.responded(500); h.pageError() }],
    ['replacement answered 401', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.responded(401); h.pageError() }],
    ['replacement answered 403', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.responded(403); h.pageError() }],
    ['non-cancel network failure', (h: ReturnType<typeof harness>) => { h.failed('The network connection was lost.'); h.responded(200); h.pageError() }],
    ['cancel of another url', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled', 'http://localhost:3200/api/editorial/articles'); h.responded(200); h.pageError() }],
    ['cancel of a query url', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled', `${URL_}?x=1`); h.responded(200); h.pageError() }],
    ['cancelled PATCH, not the bell fetch', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled', URL_, 'PATCH'); h.responded(200); h.pageError() }],
    ['two page errors, one cancel pair', (h: ReturnType<typeof harness>) => { h.failed('Load request cancelled'); h.responded(200); h.pageError(); h.pageError() }],
  ])('keeps evidence: %s', (_name, run) => {
    const h = harness()
    run(h)
    expect(h.errors.length).toBeGreaterThan(0)
  })

  it('reports a failing response even when no page error occurs', () => {
    const h = harness()
    h.responded(500)
    expect(h.errors).toEqual([`notifications responded 500: ${URL_}`])
  })

  it('reports a non-cancel failure even when no page error occurs', () => {
    const h = harness()
    h.failed('The network connection was lost.')
    expect(h.errors).toHaveLength(1)
  })

  it('does not tolerate page errors that differ from the exact message', () => {
    for (const message of [
      '/localhost:3200/api/editorial/notifications/abc due to access control checks.',
      '/localhost:3200/api/editorial/notifications?x=1 due to access control checks.',
      '/localhost:3200/api/editorial/articles due to access control checks.',
      '/example.com/api/editorial/notifications due to access control checks.',
      `${MESSAGE} and more`,
      'TypeError: Load failed',
    ]) {
      expect(isNotificationPollErrorMessage(message)).toBe(false)
      const h = harness()
      h.failed('Load request cancelled'); h.responded(200); h.pageError(message)
      expect(h.errors).toHaveLength(1)
    }
    expect(isNotificationPollUrl('http://example.com/api/editorial/notifications')).toBe(false)
  })

  describe('Chromium net::ERR_ABORTED', () => {
    it('tolerates the bell fetch aborted by a main-frame navigation that started after it, with no replacement', () => {
      const h = harness()
      const bell = h.start(); h.navigate(); h.abort(bell)
      expect(h.errors).toEqual([])
    })

    it('tolerates it when the navigation event is seen only after the abort', () => {
      const h = harness()
      const bell = h.start(); h.abort(bell)
      expect(h.errors).toHaveLength(1)
      h.navigate()
      expect(h.errors).toEqual([])
    })

    it.each([
      ['no navigation at all', (h: ReturnType<typeof harness>) => { h.abort(h.start()) }],
      ['navigation started before the bell request', (h: ReturnType<typeof harness>) => { h.navigate(); h.abort(h.start()) }],
      ['navigation in a sub-frame only', (h: ReturnType<typeof harness>) => { const b = h.start(); h.navigate(false); h.abort(b) }],
      ['abort of a request that was never seen starting', (h: ReturnType<typeof harness>) => { h.navigate(); h.failed('net::ERR_ABORTED') }],
      ['a different failure after navigation', (h: ReturnType<typeof harness>) => { const b = h.start(); h.navigate(); h.abort(b, 'net::ERR_CONNECTION_REFUSED') }],
      ['a 500 after navigation', (h: ReturnType<typeof harness>) => { h.start(); h.navigate(); h.responded(500) }],
      ['a 401 after navigation', (h: ReturnType<typeof harness>) => { h.start(); h.navigate(); h.responded(401) }],
    ])('keeps evidence: %s', (_name, run) => {
      const h = harness()
      run(h)
      expect(h.errors.length).toBeGreaterThan(0)
    })

    it.each([
      ['another url', 'http://localhost:3200/api/editorial/articles', 'GET'],
      ['a query url', `${URL_}?x=1`, 'GET'],
      ['a PATCH', URL_, 'PATCH'],
    ])('does not let an abort of %s explain, or stand in for, the bell abort', (_name, url, method) => {
      const h = harness()
      const other = h.start(url, method); h.abort(other) // not the bell fetch: never tolerated, never recorded
      expect(h.errors).toEqual([])
      const bell = h.start(); h.abort(bell) // a real bell abort with no navigation behind it
      expect(h.errors).toHaveLength(1)
    })

    it('tolerates only the aborts a navigation explains', () => {
      const h = harness()
      const first = h.start(); h.navigate(); h.abort(first)
      const second = h.start(); h.abort(second) // no navigation since this one started
      expect(h.errors).toHaveLength(1)
    })
  })
})
