// One-time feedback that must outlive a client-side navigation: the page that
// raised it is gone by the time the message is wanted, and a query parameter would
// leave it in the URL, the history and any copied link. sessionStorage is per tab,
// is never sent to the server, and the message is deleted the moment it is read.
const KEY = 'consilium:route-feedback'
type Feedback = { message: string; userId: string; path: string; at: number }
let memory: Feedback | null = null

export function queueRouteFeedback(message: string, userId: string, path: string): void {
  memory = { message, userId, path, at: Date.now() }
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // The mounted app can still carry feedback across client navigation without storage.
  }
}

/** Returns the queued message and removes it, so it can be shown exactly once. */
export function takeRouteFeedback(userId: string, path: string): string | null {
  let candidate: unknown = memory
  memory = null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    if (raw !== null) candidate = JSON.parse(raw)
  } catch {
    // Retain the in-memory fallback when access is denied.
  }
  const parsed = candidate as Partial<Feedback> | null
  return parsed && typeof parsed.message === 'string' && parsed.message && parsed.userId === userId && parsed.path === path
    && typeof parsed.at === 'number' && Date.now() >= parsed.at && Date.now() - parsed.at <= 30_000 ? parsed.message : null
}
