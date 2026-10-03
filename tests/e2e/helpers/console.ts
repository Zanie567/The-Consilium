import type { Page, ConsoleMessage } from '@playwright/test'

/**
 * Collects real console errors + uncaught page exceptions while a page is used.
 * Filters out noise that does not indicate an app bug (missing favicon, aborted
 * navigations, external image/font hiccups) so "0 console errors" stays
 * meaningful rather than flaky.
 */
const IGNORE = [
  /favicon\.ico/i,
  /ResizeObserver loop/i,
  /net::ERR_ABORTED/i, // a navigation or prefetch cancelled by the next click
  /Download the React DevTools/i,
]

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

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORE.some((re) => re.test(text)) || isThirdPartyResourceFailure(msg)) return
    errors.push(`${text} @ ${msg.location().url}`)
  }
  page.on('console', onConsole)
  page.on('pageerror', (err) => {
    if (IGNORE.some((re) => re.test(err.message))) return
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}
