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
  page.on('pageerror', (err) => {
    if (isCancelledPrefetchNoise(err.message)) return
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}
