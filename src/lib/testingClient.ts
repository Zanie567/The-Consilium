'use client'
let tabId: string | undefined
let transitioning = false
export function isTestingTransition() { return transitioning }
export function setTestingTransition(value: boolean) { transitioning = value }
/** Non-secret identifier used only to avoid reloading the initiating tab twice. */
export function getTestingTabId() { return tabId ??= crypto.randomUUID() }

/** Leave framework navigation/abort semantics untouched; pin only our API writes. */
export function identityPinnedFetch(original: typeof fetch, identity: string | undefined, origin: string): typeof fetch {
  return (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (!identity || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return original(input, init)
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, origin)
    if (url.origin !== origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/testing-session')) return original(input, init)
    const request = new Request(input, init)
    request.headers.set('x-consilium-identity', identity)
    return original(request)
  }
}
