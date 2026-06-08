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
  /net::ERR_ABORTED/i,
  /Failed to load resource/i, // external images (Unsplash) etc. — not an app bug
  /unsplash\.com/i,
  /the[_-]?consilium\.co\.uk/i,
  /Download the React DevTools/i,
]

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORE.some((re) => re.test(text))) return
    errors.push(text)
  }
  page.on('console', onConsole)
  page.on('pageerror', (err) => {
    if (IGNORE.some((re) => re.test(err.message))) return
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}
