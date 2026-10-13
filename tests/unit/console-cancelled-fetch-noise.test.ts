import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import { collectConsoleErrors, isNotificationPollErrorMessage, isNotificationPollUrl } from '../e2e/helpers/console'

const URL_ = 'http://localhost:3200/api/editorial/notifications'
const DOC = 'http://localhost:3200/editorial'
const MESSAGE = '/localhost:3200/api/editorial/notifications due to access control checks.'
const ABORTED = 'net::ERR_ABORTED'
const CANCELLED = 'Load request cancelled'

/**
 * Drives the collector with the events Playwright emits, in the order a test chooses. A "document navigation" is the
 * main-frame navigation request, its document response and the main frame's `framenavigated` (the commit).
 */
function harness() {
  const handlers: Record<string, (value: never) => void> = {}
  let mainUrl = 'http://localhost:3200/'
  const MAIN = { url: () => mainUrl }
  const page = { on: (event: string, handler: (value: never) => void) => { handlers[event] = handler }, mainFrame: () => MAIN } as unknown as Page
  const errors = collectConsoleErrors(page)
  const emit = (event: string, value: unknown) => handlers[event](value as never)
  return {
    errors,
    // --- document navigation ---
    nav: (url = DOC, redirectedFrom: unknown = null, mainFrame = true) => {
      const request = { url: () => url, method: () => 'GET', isNavigationRequest: () => true, frame: () => (mainFrame ? MAIN : {}), redirectedFrom: () => redirectedFrom }
      emit('request', request)
      return request
    },
    navResponse: (request: unknown, status = 200) => emit('response', { url: () => (request as { url: () => string }).url(), status: () => status, request: () => request }),
    commit: (url = DOC, mainFrame = true) => { if (mainFrame) mainUrl = url; emit('framenavigated', mainFrame ? MAIN : { url: () => url }) },
    // --- the bell's fetch ---
    bell: (url = URL_, method = 'GET') => {
      const request = { url: () => url, method: () => method, isNavigationRequest: () => false, frame: () => MAIN, redirectedFrom: () => null }
      emit('request', request)
      return request
    },
    fail: (request: unknown, reason = ABORTED) => emit('requestfailed', Object.assign(request as object, { failure: () => ({ errorText: reason }) })),
    failUnseen: (reason = ABORTED, url = URL_, method = 'GET') => emit('requestfailed', { url: () => url, method: () => method, failure: () => ({ errorText: reason }) }),
    responded: (status: number, url = URL_, method = 'GET') => emit('response', { url: () => url, status: () => status, request: () => ({ method: () => method }) }),
    pageError: (message = MESSAGE) => emit('pageerror', new Error(message)),
    consoleError: (text: string) => emit('console', { type: () => 'error', text: () => text, location: () => ({ url: 'http://localhost:3200/' }) }),
  }
}
type H = ReturnType<typeof harness>

describe('the three sequences seen in CI', () => {
  // team-profile mobile (run 38275729256): the document request left 5 ms BEFORE the outgoing page started the bell fetch.
  it('Chromium: navigation request, bell starts, document commits, bell aborted', () => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell(); h.navResponse(nav); h.commit(); h.fail(bell)
    expect(h.errors).toEqual([])
  })

  // team-profile :471 (run 38181217078) and wf-testing-scenarios: the fetch is already running when the navigation is requested.
  it('Chromium: bell starts, navigation request, document commits, bell aborted', () => {
    const h = harness()
    const bell = h.bell(); const nav = h.nav(); h.navResponse(nav); h.commit(); h.fail(bell)
    expect(h.errors).toEqual([])
  })

  // wf-testing-scenarios (run 38315612240): WebKit exposed NO request for the fetch, only the page error, before the commit.
  it('WebKit: navigation request, exact page error only, document commits', () => {
    const h = harness()
    const nav = h.nav(); h.pageError(); h.navResponse(nav)
    expect(h.errors).toEqual([`pageerror: ${MESSAGE}`]) // visible until the commit confirms the navigation
    h.commit()
    expect(h.errors).toEqual([])
  })

  // run 38095772683: WebKit exposed the cancel as well as the page error.
  it('WebKit: recorded cancel and page error for one fetch, in one committed navigation', () => {
    const h = harness()
    const bell = h.bell(); const nav = h.nav(); h.fail(bell, CANCELLED); h.pageError(); h.navResponse(nav); h.commit()
    expect(h.errors).toEqual([])
  })
})

describe('event order', () => {
  it.each([
    ['abort, then the document response, then the commit', (h: H) => { const n = h.nav(); const b = h.bell(); h.fail(b); h.navResponse(n); h.commit() }],
    ['abort after the commit event', (h: H) => { const n = h.nav(); const b = h.bell(); h.navResponse(n); h.commit(); h.fail(b) }],
    ['commit event before the navigation response event', (h: H) => { const n = h.nav(); const b = h.bell(); h.commit(); h.fail(b); h.navResponse(n) }],
    ['page error before the response, commit last', (h: H) => { const n = h.nav(); h.pageError(); h.navResponse(n); h.commit() }],
    ['commit URL differing only by a fragment', (h: H) => { const n = h.nav(`${DOC}#top`); const b = h.bell(); h.navResponse(n); h.commit(DOC); h.fail(b) }],
  ])('explains the failure whichever way round the events arrive: %s', (_name, run) => {
    const h = harness()
    run(h)
    expect(h.errors).toEqual([])
  })

  it('keeps a failure visible until the commit confirms it, and then clears only that failure', () => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell(); h.fail(bell); h.pageError('TypeError: boom')
    expect(h.errors).toHaveLength(2)
    h.navResponse(nav); h.commit()
    expect(h.errors).toEqual(['pageerror: TypeError: boom'])
  })

  it('follows a redirect chain: the window opens at the first request', () => {
    const h = harness()
    const first = h.nav(`${DOC}?old`); const bell = h.bell(); h.fail(bell)
    h.navResponse(first, 302)
    const second = h.nav(DOC, first); h.navResponse(second); h.commit()
    expect(h.errors).toEqual([])
  })

  it('does not open the window earlier than the navigation request it can see', () => {
    const h = harness()
    const first = h.nav(`${DOC}?old`); const bell = h.bell(); h.fail(bell)
    h.navResponse(first, 302)
    const unrelated = h.nav(DOC); h.navResponse(unrelated); h.commit() // not linked to `first`: the failure predates this navigation
    expect(h.errors).toHaveLength(1)
  })
})

describe('what is never explained by a navigation', () => {
  type Sequence = (h: H) => void
  const chromium = (middle: (h: H, nav: unknown, bell: unknown) => void): Sequence => (h) => { const nav = h.nav(); const bell = h.bell(); middle(h, nav, bell) }
  const webkit = (middle: (h: H, nav: unknown) => void): Sequence => (h) => { const nav = h.nav(); middle(h, nav) }

  it.each<[string, Sequence]>([
    ['Chromium: the navigation never commits', chromium((h, nav, bell) => { h.navResponse(nav); h.fail(bell) })],
    ['WebKit: the navigation never commits', webkit((h, nav) => { h.pageError(); h.navResponse(nav) })],
    ['Chromium: the navigation request is never answered, though a commit is seen', chromium((h, _nav, bell) => { h.commit(); h.fail(bell) })],
    ['WebKit: the navigation request is never answered, though a commit is seen', webkit((h) => { h.pageError(); h.commit() })],
    ['Chromium: no navigation at all', (h) => { h.fail(h.bell()) }],
    ['WebKit: no navigation at all', (h) => { h.pageError() }],
    ['Chromium: the document committed before the bell fetch started', (h) => { const n = h.nav(); h.navResponse(n); h.commit(); h.fail(h.bell()) }],
    ['WebKit: the document committed before the page error', (h) => { const n = h.nav(); h.navResponse(n); h.commit(); h.pageError() }],
    ['Chromium: the failure was seen before the navigation request', (h) => { const b = h.bell(); h.fail(b); const n = h.nav(); h.navResponse(n); h.commit() }],
    ['WebKit: the page error was seen before the navigation request', (h) => { h.pageError(); const n = h.nav(); h.navResponse(n); h.commit() }],
    ['Chromium: a client-side route change (framenavigated, no document request)', (h) => { const b = h.bell(); h.commit('http://localhost:3200/editorial/team-profile'); h.fail(b) }],
    ['WebKit: a client-side route change (framenavigated, no document request)', (h) => { h.pageError(); h.commit('http://localhost:3200/editorial/team-profile') }],
    ['Chromium: a client-side route change while another navigation is unanswered', chromium((h, _nav, bell) => { h.commit('http://localhost:3200/editorial/team-profile'); h.fail(bell) })],
    ['Chromium: the commit is for a different URL than the answered navigation', chromium((h, nav, bell) => { h.navResponse(nav); h.commit('http://localhost:3200/other'); h.fail(bell) })],
    ['Chromium: the commit is in a sub-frame', chromium((h, nav, bell) => { h.navResponse(nav); h.commit(DOC, false); h.fail(bell) })],
    ['Chromium: the navigation request is in a sub-frame', (h) => { const n = h.nav(DOC, null, false); const b = h.bell(); h.navResponse(n); h.commit(); h.fail(b) }],
    ['Chromium: the navigation was answered by a redirect only', chromium((h, nav, bell) => { h.navResponse(nav, 302); h.commit(); h.fail(bell) })],
    ['Chromium: the navigation was answered with a 204, which has no document', chromium((h, nav, bell) => { h.navResponse(nav, 204); h.commit(); h.fail(bell) })],
    ['Chromium: the aborted request was never seen starting', (h) => { const n = h.nav(); h.navResponse(n); h.commit(); h.failUnseen() }],
  ])('keeps the failure: %s', (_name, run) => {
    const h = harness()
    run(h)
    expect(h.errors.length).toBeGreaterThan(0)
  })

  it.each([
    ['a connection failure', 'net::ERR_CONNECTION_REFUSED'],
    ['a timeout', 'net::ERR_TIMED_OUT'],
    ['a dropped connection', 'The network connection was lost.'],
    ['a near-miss reason', 'net::ERR_ABORTED2'],
  ])('keeps %s for the bell fetch even inside a committed navigation', (_name, reason) => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell(); h.navResponse(nav); h.commit(); h.fail(bell, reason)
    expect(h.errors).toEqual([`requestfailed: ${URL_} ${reason}`])
  })

  it.each([
    ['another url', 'http://localhost:3200/api/editorial/articles', 'GET'],
    ['a query url', `${URL_}?x=1`, 'GET'],
    ['another host', 'http://example.com/api/editorial/notifications', 'GET'],
    ['a PATCH', URL_, 'PATCH'],
  ])('does not treat an abort of %s as the bell fetch', (_name, url, method) => {
    const h = harness()
    const nav = h.nav(); const other = h.bell(url, method); h.navResponse(nav); h.commit(); h.fail(other)
    expect(h.errors).toEqual([]) // never the bell's fetch, so never recorded and never able to stand in for it
    const bell = h.bell(); h.fail(bell) // a genuine bell abort afterwards, with no navigation behind it
    expect(h.errors).toHaveLength(1)
  })

  it.each([
    '/localhost:3200/api/editorial/notifications/abc due to access control checks.',
    '/localhost:3200/api/editorial/notifications?x=1 due to access control checks.',
    '/localhost:3200/api/editorial/articles due to access control checks.',
    '/localhost:3200/about?_x=1 due to access control checks.',
    '/example.com/api/editorial/notifications due to access control checks.',
    `${MESSAGE} and more`,
    'TypeError: Load failed',
  ])('keeps a different page error inside a committed navigation: %s', (message) => {
    expect(isNotificationPollErrorMessage(message)).toBe(false)
    const h = harness()
    const nav = h.nav(); h.pageError(message); h.navResponse(nav); h.commit()
    expect(h.errors).toEqual([`pageerror: ${message}`])
  })

  it.each([401, 403, 500])('still reports a notifications response of %i inside a committed navigation', (status) => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell(); h.navResponse(nav); h.commit(); h.fail(bell)
    h.responded(status)
    expect(h.errors).toEqual([`notifications responded ${status}: ${URL_}`])
  })

  it('does not report a 200, and reports a response on its own without any navigation', () => {
    const h = harness()
    h.responded(200)
    expect(h.errors).toEqual([])
    h.responded(500)
    expect(h.errors).toEqual([`notifications responded 500: ${URL_}`])
  })

  it('keeps console errors, uncaught exceptions and other failures that occur during the same navigation', () => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell()
    h.consoleError('Something broke')
    h.pageError('TypeError: boom')
    h.responded(500)
    h.navResponse(nav); h.commit(); h.fail(bell)
    expect(h.errors).toEqual([
      'Something broke @ http://localhost:3200/',
      'pageerror: TypeError: boom',
      `notifications responded 500: ${URL_}`,
    ])
  })
})

describe('one navigation explains one fetch, not a stream of failures', () => {
  it('two aborts in one window: one stays', () => {
    const h = harness()
    const nav = h.nav(); const first = h.bell(); const second = h.bell(); h.navResponse(nav); h.commit(); h.fail(first); h.fail(second)
    expect(h.errors).toHaveLength(1)
  })

  it('two page errors in one window: one stays', () => {
    const h = harness()
    const nav = h.nav(); h.pageError(); h.pageError(); h.navResponse(nav); h.commit()
    expect(h.errors).toEqual([`pageerror: ${MESSAGE}`])
  })

  it('a WebKit request-level cancel is not an error either way it is spelled, and does not use up the window', () => {
    for (const reason of [CANCELLED, 'cancelled']) {
      const h = harness()
      const bell = h.bell(); h.fail(bell, reason) // WebKit can deliver this before the navigation request event
      expect(h.errors).toEqual([])
      const nav = h.nav(); h.pageError(); h.navResponse(nav); h.commit()
      expect(h.errors).toEqual([]) // the page error is explained by the window; the cancel never counted
    }
  })

  it('a second failure after the window has been used up stays visible', () => {
    const h = harness()
    const nav = h.nav(); const bell = h.bell(); h.navResponse(nav); h.commit(); h.fail(bell)
    expect(h.errors).toEqual([])
    const later = h.bell(); h.fail(later) // the new document's own fetch, aborted for another reason
    h.pageError()
    expect(h.errors).toHaveLength(2)
  })

  it('each navigation explains its own failure, and no more', () => {
    const h = harness()
    const first = h.nav(); const bell1 = h.bell(); h.navResponse(first); h.commit(); h.fail(bell1)
    const second = h.nav(`${DOC}/next`); const bell2 = h.bell(); h.navResponse(second); h.commit(`${DOC}/next`); h.fail(bell2)
    expect(h.errors).toEqual([])
    const third = h.bell(); h.fail(third)
    expect(h.errors).toHaveLength(1)
  })

  it('a later commit with no navigation request of its own explains nothing', () => {
    const h = harness()
    const nav = h.nav(); const bell1 = h.bell(); h.navResponse(nav); h.commit(); h.fail(bell1)
    const bell2 = h.bell(); h.fail(bell2)
    h.commit(`${DOC}/pushed`) // a client-side route change
    expect(h.errors).toHaveLength(1)
  })
})

describe('exact matching helpers', () => {
  it('matches only the exact same-origin bell url and the exact page error', () => {
    expect(isNotificationPollUrl(URL_)).toBe(true)
    expect(isNotificationPollUrl(`${URL_}?x=1`)).toBe(false)
    expect(isNotificationPollUrl('http://example.com/api/editorial/notifications')).toBe(false)
    expect(isNotificationPollErrorMessage(MESSAGE)).toBe(true)
  })
})
