import type { Page } from '@playwright/test'
/** Capture every console error and page exception without filtering. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', m => { if(m.type()==='error') errors.push(`${m.text()} @ ${m.location().url}`) })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  return errors
}
