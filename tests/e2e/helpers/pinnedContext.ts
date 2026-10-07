import { expect, type Browser, type BrowserContextOptions } from '@playwright/test'

/** API requests bypass the browser interceptor; pin the current identity once.
 * A later revocation must leave this context stale rather than silently refresh it.
 */
export async function pinnedContext(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options)
  try {
    const response = await context.request.get(`${process.env.E2E_BASE_URL}/api/auth/session`)
    expect(response.status()).toBe(200)
    const session = await response.json()
    expect(session.user?.id).toBeTruthy()
    expect(session.requestIdentity).toBeTruthy()
    await context.setExtraHTTPHeaders({
      ...options.extraHTTPHeaders,
      'x-consilium-identity': session.requestIdentity,
    })
    return context
  } catch (error) {
    await context.close()
    throw error
  }
}
