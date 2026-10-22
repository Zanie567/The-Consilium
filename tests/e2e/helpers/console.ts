import type { Page, ConsoleMessage } from '@playwright/test'

/**
 * Collects real console errors + uncaught page exceptions while a page is used.
 * Only third-party image/font resource failures are excluded. Application errors,
 * including favicon, ResizeObserver and aborted API failures, remain evidence.
 */
/**
 * "Failed to load resource" is Chrome's one-line log for ANY 4xx/5xx, including the
 * app's own API calls, so it must not be ignored wholesale (it used to be, which hid
 * every failing fetch). Only failures of third-party image/font hosts we do not control
 * are tolerated; the failing URL comes from the message location.
 */
const THIRD_PARTY_HOSTS = /(^|\.)(images\.unsplash\.com|lh3\.googleusercontent\.com|fonts\.gstatic\.com|fonts\.googleapis\.com)$/i

function isThirdPartyResourceFailure(msg: ConsoleMessage): boolean {
  if (!/Failed to load resource/i.test(msg.text())) return false
  try {
    return THIRD_PARTY_HOSTS.test(new URL(msg.location().url).hostname)
  } catch {
    return false
  }
}

/**
 * WebKit reports a Next.js <Link> prefetch (`?_rsc=`) cancelled by a navigation as an
 * uncaught page error whose whole message is `<url> due to access control checks.`
 * (CI: the WebKit view-transition test failed intermittently on it in both repositories;
 * the trace showed the requests as "Load request cancelled" started just before the
 * navigation). It is a same-origin cancelled fetch, not an application failure, and
 * Chromium does not surface it. Only that exact shape, for a localhost `_rsc` URL, is
 * tolerated: every other page error, including other `_rsc` failures, remains evidence.
 * The `_rsc` value is base64url, so it may contain `-` as well as `\w` characters: matching
 * only `\w` let the same cancelled prefetch fail a test whenever its hash held a `-`
 * (wf-testing-scenarios on WebKit, Next 16.4; the trace showed status -1, no response, at a
 * page.goto, while every completed prefetch of those URLs answered 200).
 */
const CANCELLED_PREFETCH = /^\/localhost:\d+\/[^\s?]*\?(?:[^\s&]*&)*_rsc=[\w-]+ due to access control checks\.$/

/**
 * The notification bell fetches `GET /api/editorial/notifications` once, when the portal mounts. A full-document navigation
 * (page.goto, a reload, `window.location.assign`) replaces the outgoing document, and the outgoing document can still be running
 * (and can start that fetch) until the new one commits. The browser then cancels the fetch, and the two engines report the
 * cancellation differently, and not always completely:
 *   Chromium: `requestfailed` with exactly `net::ERR_ABORTED`.
 *   WebKit:   the page error below, sometimes with a `requestfailed` "Load request cancelled", sometimes (when the fetch started
 *             while the navigation was already pending) with NO request event at all, so a pairing of events cannot be relied on.
 * What both have in common is the cause, so that is the evidence: the failure belongs to a genuine DOCUMENT navigation, i.e. it
 * happened in the window that starts when a main-frame navigation request is sent and ends when that document commits.
 * A commit is a main-frame `request` (isNavigationRequest) that received a document response (not a redirect, not a 204),
 * paired with a main-frame `framenavigated` for the same URL. A client-side route change (`pushState`) also fires
 * `framenavigated`, but has no navigation request or response behind it, so it never pairs.
 *
 * A notifications failure is removed from the report only when a committed window explains it, and one window explains at most
 * one failure (the outgoing document mounted the bell once):
 *   - Chromium abort: `requestfailed`, GET, exactly `net::ERR_ABORTED`, for a fetch we saw start BEFORE the commit (so it belonged
 *     to the outgoing document), seen after the navigation request. It may be seen before or after the commit event.
 *   - WebKit page error: the exact message, seen after the navigation request and BEFORE the commit event. WebKit gives no request
 *     to check (so its method cannot be verified), only this message and the window; a page error after the commit is evidence.
 * A WebKit `requestfailed` that merely says the request was cancelled has never been an error here and still is not: WebKit
 * delivers it before the navigation request event and spells it differently per platform, so its order cannot be trusted. The
 * failure signal WebKit gives is the page error above. That is the one place this collector is lenient without a navigation.
 * Everything else stays evidence: other URLs, methods, reasons and messages, non-200 responses, a navigation that never commits,
 * a client-side route change, a failure with no navigation behind it or after the commit, and every further failure in the same
 * window. Until a window explains it a failure simply stays in the report; nothing is held back waiting for an event.
 */
const NOTIFICATION_POLL_ERROR = /^\/localhost:\d+\/api\/editorial\/notifications due to access control checks\.$/
const CHROMIUM_ABORT = 'net::ERR_ABORTED'
const WEBKIT_CANCEL = /^(Load request )?cancell?ed$/i // a cancelled request is not a failure; see above

export function isNotificationPollErrorMessage(message: string): boolean {
  return NOTIFICATION_POLL_ERROR.test(message)
}

export function isNotificationPollUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.hostname === 'localhost' && url.pathname === '/api/editorial/notifications' && url.search === ''
  } catch {
    return false
  }
}

export function isCancelledPrefetchNoise(message: string): boolean {
  return CANCELLED_PREFETCH.test(message)
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isThirdPartyResourceFailure(msg)) return
    errors.push(`${text} @ ${msg.location().url}`)
  }
  page.on('console', onConsole)

  let seq = 0 // orders every event this collector sees
  const withoutHash = (raw: string) => { try { const u = new URL(raw); u.hash = ''; return u.href } catch { return raw } }

  // Document navigations. `start` is the seq of the first request of a redirect chain, where the window opens.
  const navigations = new Map<object, { start: number; url: string; responded: boolean; paired: boolean }>()
  const unpairedCommits: { seq: number; url: string }[] = []
  // A committed navigation. `used`: it has explained its one failure.
  const windows: { start: number; commit: number; used: boolean }[] = []
  // Notifications failures that are in `errors` and may be explained by a window. `startedAt` is set for request-level ones.
  const candidates: { entry: string; at: number; startedAt?: number }[] = []
  const started = new WeakMap<object, number>() // bell request -> seq at which it started

  const reconcile = () => {
    for (let i = 0; i < unpairedCommits.length; i++) {
      const commit = unpairedCommits[i]
      const nav = [...navigations.values()].find((n) => n.responded && n.url === commit.url && !n.paired)
      if (!nav) continue
      nav.paired = true
      windows.push({ start: nav.start, commit: commit.seq, used: false })
      unpairedCommits.splice(i--, 1)
    }
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      const requestLevel = c.startedAt !== undefined
      const window = windows.find((w) => !w.used && w.start < c.at && (requestLevel ? (c.startedAt as number) < w.commit : c.at < w.commit))
      if (!window) continue
      window.used = true
      const at = errors.indexOf(c.entry)
      if (at !== -1) errors.splice(at, 1)
      candidates.splice(i--, 1)
    }
  }

  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const previous = request.redirectedFrom?.()
      const root = previous ? navigations.get(previous) : undefined
      navigations.set(request, { start: root ? root.start : ++seq, url: withoutHash(request.url()), responded: false, paired: false })
    } else if (request.method() === 'GET' && isNotificationPollUrl(request.url())) {
      started.set(request, ++seq)
    }
  })
  page.on('requestfailed', (request) => {
    if (request.method() !== 'GET' || !isNotificationPollUrl(request.url())) return
    const reason = request.failure()?.errorText ?? ''
    if (WEBKIT_CANCEL.test(reason)) return
    const entry = `requestfailed: ${request.url()} ${reason}`
    errors.push(entry)
    if (reason === CHROMIUM_ABORT && started.has(request)) {
      candidates.push({ entry, at: ++seq, startedAt: started.get(request) as number })
      reconcile()
    }
  })
  page.on('response', (response) => {
    const navigation = navigations.get(response.request())
    if (navigation && ![204, 205].includes(response.status()) && !(response.status() >= 300 && response.status() < 400)) {
      navigation.responded = true // a redirect, or a response with no document, commits nothing
      reconcile()
    }
    if (response.request().method() !== 'GET' || !isNotificationPollUrl(response.url())) return
    if (response.status() !== 200) errors.push(`notifications responded ${response.status()}: ${response.url()}`)
  })
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    unpairedCommits.push({ seq: ++seq, url: withoutHash(frame.url()) })
    reconcile()
  })
  page.on('pageerror', (err) => {
    if (isCancelledPrefetchNoise(err.message)) return
    const entry = `pageerror: ${err.message}`
    errors.push(entry)
    if (isNotificationPollErrorMessage(err.message)) {
      candidates.push({ entry, at: ++seq })
      reconcile()
    }
  })
  return errors
}
