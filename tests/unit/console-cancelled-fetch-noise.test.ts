import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import { collectConsoleErrors, isNotificationPollErrorMessage, isNotificationPollUrl } from '../e2e/helpers/console'

const URL_ = 'http://localhost:3200/api/editorial/notifications'
const DOC = 'http://localhost:3200/editorial'
const MESSAGE = '/localhost:3200/api/editorial/notifications due to access control checks.'

function harness() {
  const handlers: Record<string, (value: never) => void> = {}
  let mainUrl = 'http://localhost:3200/'
  const MAIN = { url: () => mainUrl }
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
    // A full-document navigation: its request, the document response, and the main frame's commit (`framenavigated`).
    docNav: (url = DOC) => { const request = { url: () => url, method: () => 'GET', isNavigationRequest: () => true, frame: () => MAIN }; emit('request', request); return request },
    docResponse: (request: unknown, status = 200) => emit('response', { url: () => (request as { url: () => string }).url(), status: () => status, request: () => request }),
    commit: (url = DOC, mainFrame = true) => { if (mainFrame) mainUrl = url; emit('framenavigated', mainFrame ? MAIN : { url: () => url }) },
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

  // The navigation was already pending when the bell request started (CI: team-profile mobile, `goto` right after sign-in).
  describe('Chromium net::ERR_ABORTED, navigation already pending', () => {
    type H = ReturnType<typeof harness>
    it('tolerates: navigation request, bell starts, document commits, bell aborts', () => {
      const h = harness()
      const nav = h.docNav(); const bell = h.start(); h.docResponse(nav); h.commit(); h.abort(bell)
      expect(h.errors).toEqual([])
    })

    it('tolerates the abort arriving before the commit, once the commit is confirmed', () => {
      const h = harness()
      const nav = h.docNav(); const bell = h.start(); h.docResponse(nav); h.abort(bell)
      expect(h.errors).toHaveLength(1)
      h.commit()
      expect(h.errors).toEqual([])
    })

    it('tolerates the commit being seen before the navigation response event', () => {
      const h = harness()
      const nav = h.docNav(); const bell = h.start(); h.abort(bell); h.commit()
      expect(h.errors).toHaveLength(1)
      h.docResponse(nav)
      expect(h.errors).toEqual([])
    })

    it('tolerates a hash-only difference between the request and the committed URL', () => {
      const h = harness()
      const nav = h.docNav(`${DOC}#top`); const bell = h.start(); h.docResponse(nav); h.commit(DOC); h.abort(bell)
      expect(h.errors).toEqual([])
    })

    it.each([
      ['the document committed before the bell request started', (h: H) => { const n = h.docNav(); h.docResponse(n); h.commit(); h.abort(h.start()) }],
      ['the navigation never commits', (h: H) => { const n = h.docNav(); const b = h.start(); h.docResponse(n); h.abort(b) }],
      ['the navigation never gets a response, though a commit is seen', (h: H) => { h.docNav(); const b = h.start(); h.commit(); h.abort(b) }],
      ['a commit with no navigation request behind it', (h: H) => { const b = h.start(); h.commit(); h.abort(b) }],
      ['a client-side route change (framenavigated, no document request)', (h: H) => { const b = h.start(); h.commit('http://localhost:3200/editorial/team-profile'); h.abort(b) }],
      ['a client-side route change while another document navigation is still unanswered', (h: H) => { h.docNav(); const b = h.start(); h.commit('http://localhost:3200/editorial/team-profile'); h.abort(b) }],
      ['a commit for a different URL than the answered navigation', (h: H) => { const n = h.docNav(); const b = h.start(); h.docResponse(n); h.commit('http://localhost:3200/other'); h.abort(b) }],
      ['a commit in a sub-frame only', (h: H) => { const n = h.docNav(); const b = h.start(); h.docResponse(n); h.commit(DOC, false); h.abort(b) }],
      ['a redirect response, which commits nothing', (h: H) => { const n = h.docNav(); const b = h.start(); h.docResponse(n, 302); h.commit(); h.abort(b) }],
      ['a 204 response, which has no document to commit', (h: H) => { const n = h.docNav(); const b = h.start(); h.docResponse(n, 204); h.commit(); h.abort(b) }],
      ['a navigation request seen only in a sub-frame', (h: H) => { h.navigate(false); const b = h.start(); h.commit(); h.abort(b) }],
    ])('keeps evidence: %s', (_name, run) => {
      const h = harness()
      run(h)
      expect(h.errors.length).toBeGreaterThan(0)
    })

    it.each([
      ['another url', 'http://localhost:3200/api/editorial/articles', 'GET', 'net::ERR_ABORTED'],
      ['a query url', `${URL_}?x=1`, 'GET', 'net::ERR_ABORTED'],
      ['a PATCH', URL_, 'PATCH', 'net::ERR_ABORTED'],
      ['a connection failure', URL_, 'GET', 'net::ERR_CONNECTION_REFUSED'],
      ['a timeout', URL_, 'GET', 'net::ERR_TIMED_OUT'],
    ])('does not tolerate %s even with a pending navigation and a commit', (_name, url, method, reason) => {
      const h = harness()
      const nav = h.docNav(); const request = h.start(url, method); h.docResponse(nav); h.commit(); h.abort(request, reason)
      // Other URLs and methods are never recorded at all; the same-url failures stay recorded.
      if (url === URL_ && method === 'GET') expect(h.errors).toHaveLength(1)
      else expect(h.errors).toEqual([])
    })

    it.each([401, 403, 500])('still reports a notifications response of %i after a pending navigation committed', (status) => {
      const h = harness()
      const nav = h.docNav(); const bell = h.start(); h.docResponse(nav); h.commit(); h.abort(bell)
      h.responded(status)
      expect(h.errors).toEqual([`notifications responded ${status}: ${URL_}`])
    })

    it('keeps other console errors, page exceptions and WebKit-style page errors', () => {
      const h = harness()
      const nav = h.docNav(); const bell = h.start(); h.docResponse(nav); h.commit(); h.abort(bell)
      h.pageError('TypeError: boom')
      h.pageError()
      expect(h.errors).toEqual(['pageerror: TypeError: boom', `pageerror: ${MESSAGE}`])
    })

    it('lets one commit explain only one abort', () => {
      const h = harness()
      const nav = h.docNav(); const first = h.start(); const second = h.start()
      h.docResponse(nav); h.commit(); h.abort(first); h.abort(second)
      expect(h.errors).toHaveLength(1)
    })

    it('does not let a commit clear an abort of a bell request that started after it', () => {
      const h = harness()
      const nav = h.docNav(); const early = h.start(); h.docResponse(nav); h.commit(); h.abort(early)
      const late = h.start(); h.abort(late)
      expect(h.errors).toHaveLength(1)
    })

    it('does not let one commit explain aborts of two different navigations', () => {
      const h = harness()
      const first = h.docNav(); const bell1 = h.start(); h.docResponse(first); h.commit(); h.abort(bell1)
      const bell2 = h.start(); h.abort(bell2)
      h.commit() // a later commit with no navigation request/response of its own
      expect(h.errors).toHaveLength(1)
    })
  })
})
