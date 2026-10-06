/** Configuration contains an origin only; authentication happens independently there. */
export function testingWorkspaceLink(value?: string): string | null {
  try {
    const url = new URL(value ?? '')
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
    return `${url.origin}/admin/testing`
  } catch { return null }
}
