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
 */
const CANCELLED_PREFETCH = /^\/localhost:\d+\/[^\s?]*\?(?:[^\s&]*&)*_rsc=\w+ due to access control checks\.$/

/**
 * The same WebKit page error for the one same-origin request the editorial portal starts on every mount: the
 * notification bell's `GET /api/editorial/notifications`. The message alone proves nothing (WebKit uses the same
 * text for any failed load), so it is tolerated only when the collector has independently seen BOTH that this
 * request was cancelled (`requestfailed`, "cancel") AND a later 200 for the same URL (the bell's replacement request).
 * CI trace (wf-testing-scenarios, WebKit): first request "Load request cancelled", a second answered 200 ~245 ms later.
 * Everything else about this endpoint stays evidence: a non-200 response, a non-cancel network failure, or a matching
 * page error with no cancelled-then-recovered pair behind it.
 *
 * Chromium has no page error; it reports the same unload as `requestfailed` with `net::ERR_ABORTED` (CI, team-profile.spec,
 * after navigating from the editorial portal to /team). That is tolerated only for the bell's exact GET and only when a
 * main-frame navigation request STARTED AFTER the bell request did, which is what aborts an in-flight fetch. No replacement
 * 200 is required because the page that would receive it is gone. An abort with no such navigation behind it is evidence.
 *
 * The second interleaving: the navigation request was already pending when the bell request started (the outgoing document
 * keeps running until the new one commits; CI trace, team-profile mobile: `goto('/editorial')` straight after sign-in landed
 * on /editorial, the bell fetch started 5 ms after the new document request and was aborted when it committed). That is
 * tolerated only when the abort is paired with a genuine DOCUMENT commit: a main-frame navigation request that started before
 * the bell request, received a document response, and then a main-frame `framenavigated` for that same URL. A client-side route
 * change (`pushState`) also fires `framenavigated`, but has no navigation request or response behind it, so it never pairs.
 * Each commit explains at most one abort, and the pairing works whichever order the events arrive in.
 */
const NOTIFICATION_POLL_ERROR = /^\/localhost:\d+\/api\/editorial\/notifications due to access control checks\.$/

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
  // Notification-poll bookkeeping. `seq` orders events so a 200 only counts as the replacement if it came after the cancel.
  let seq = 0
  const cancels: number[] = []
  const oks: number[] = []
  const pending: string[] = [] // page errors in `errors` waiting for a cancelled-then-recovered pair
  const reconcile = () => {
    while (pending.length && cancels.length) {
      const replacement = oks.findIndex((n) => n > cancels[0])
      if (replacement === -1) return
      cancels.shift()
      oks.splice(replacement, 1)
      const at = errors.indexOf(pending.shift() as string)
      if (at !== -1) errors.splice(at, 1)
    }
  }
  const started = new WeakMap<object, number>() // bell request -> seq at which it started
  const navigations: number[] = [] // seq of each main-frame navigation request
  const aborted: { startedAt: number; entry: string }[] = [] // Chromium aborts waiting for a later navigation
  const reconcileAborts = () => {
    for (let i = aborted.length - 1; i >= 0; i--) {
      if (!navigations.some((n) => n > aborted[i].startedAt)) continue
      const at = errors.indexOf(aborted[i].entry)
      if (at !== -1) errors.splice(at, 1)
      aborted.splice(i, 1)
    }
  }
  // Document commits: a main-frame navigation request that got a document response, paired with a main-frame
  // `framenavigated` for the same URL. Either event can be seen first, so both sides wait for their partner.
  const documentNavs = new Map<object, { seq: number; url: string; responded: boolean; matched: boolean }>()
  const unpairedCommits: { seq: number; url: string }[] = []
  const commits: { navSeq: number; seq: number }[] = [] // each explains at most one abort
  const withoutHash = (raw: string) => { try { const u = new URL(raw); u.hash = ''; return u.href } catch { return raw } }
  const reconcileCommits = () => {
    for (let i = 0; i < unpairedCommits.length; i++) {
      const commit = unpairedCommits[i]
      const nav = [...documentNavs.values()]
        .filter((n) => n.responded && !n.matched && n.url === commit.url && n.seq < commit.seq)
        .sort((a, b) => a.seq - b.seq)[0]
      if (!nav) continue
      nav.matched = true
      commits.push({ navSeq: nav.seq, seq: commit.seq })
      unpairedCommits.splice(i--, 1)
    }
    for (let i = aborted.length - 1; i >= 0; i--) {
      const commit = commits.findIndex((c) => c.navSeq < aborted[i].startedAt && aborted[i].startedAt < c.seq)
      if (commit === -1) continue
      commits.splice(commit, 1)
      const at = errors.indexOf(aborted[i].entry)
      if (at !== -1) errors.splice(at, 1)
      aborted.splice(i, 1)
    }
  }
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      navigations.push(++seq)
      documentNavs.set(request, { seq, url: withoutHash(request.url()), responded: false, matched: false })
      reconcileAborts()
    } else if (request.method() === 'GET' && isNotificationPollUrl(request.url())) {
      started.set(request, ++seq)
    }
  })
  page.on('requestfailed', (request) => {
    if (request.method() !== 'GET' || !isNotificationPollUrl(request.url())) return
    const reason = request.failure()?.errorText ?? ''
    if (/cancel/i.test(reason)) {
      cancels.push(++seq)
      reconcile()
    } else if (reason === 'net::ERR_ABORTED' && started.has(request)) {
      const entry = `requestfailed: ${request.url()} ${reason}`
      errors.push(entry)
      aborted.push({ startedAt: started.get(request) as number, entry })
      reconcileAborts()
      reconcileCommits()
    } else {
      errors.push(`requestfailed: ${request.url()} ${reason}`)
    }
  })
  page.on('response', (response) => {
    const nav = documentNavs.get(response.request())
    if (nav && ![204, 205].includes(response.status()) && !(response.status() >= 300 && response.status() < 400)) {
      nav.responded = true // a redirect, or a response with no document, commits nothing
      reconcileCommits()
    }
    if (response.request().method() !== 'GET' || !isNotificationPollUrl(response.url())) return
    if (response.status() === 200) {
      oks.push(++seq)
      reconcile()
    } else {
      errors.push(`notifications responded ${response.status()}: ${response.url()}`)
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    unpairedCommits.push({ seq: ++seq, url: withoutHash(frame.url()) })
    reconcileCommits()
  })
  page.on('pageerror', (err) => {
    if (isCancelledPrefetchNoise(err.message)) return
    const entry = `pageerror: ${err.message}`
    errors.push(entry)
    if (isNotificationPollErrorMessage(err.message)) {
      pending.push(entry)
      reconcile()
    }
  })
  return errors
}
