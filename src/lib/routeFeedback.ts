// One-time feedback that must outlive a client-side navigation: the page that
// raised it is gone by the time the message is wanted, and a query parameter would
// leave it in the URL, the history and any copied link. sessionStorage is per tab,
// is never sent to the server, and the message is deleted the moment it is read.
const KEY = 'consilium:route-feedback'

export function queueRouteFeedback(message: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ message }))
  } catch {
    // Storage can be unavailable (private mode, quota); the failure then stays unreported
    // here, but the unread state itself is held by the server and is unaffected.
  }
}

/** Returns the queued message and removes it, so it can be shown exactly once. */
export function takeRouteFeedback(): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return null
    window.sessionStorage.removeItem(KEY)
    const parsed: unknown = JSON.parse(raw)
    const message = (parsed as { message?: unknown } | null)?.message
    return typeof message === 'string' && message ? message : null
  } catch {
    return null
  }
}
