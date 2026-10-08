import { apiError } from './apiResponse'

/** Optional for legacy API clients; first-party callers supply their loaded revision. */
export function articleRevisionError(expected: unknown, actual: Date) {
  if (expected === undefined) return null
  const revision = typeof expected === 'string' ? new Date(expected) : null
  if (!revision || !Number.isFinite(revision.getTime())) {
    return apiError('The article revision is invalid.', 400, 'VALIDATION_ERROR')
  }
  if (revision.getTime() !== actual.getTime()) {
    return apiError('This article changed since this page was loaded. Reload before trying again.', 409, 'ARTICLE_CHANGED')
  }
  return null
}
