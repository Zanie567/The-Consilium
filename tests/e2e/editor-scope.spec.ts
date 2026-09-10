import { test, expect } from '@playwright/test'
import { EDITOR_GLOBAL_STORAGE, EDITOR_SCOPED_STORAGE } from './helpers/authStorage'
import { findPublishedInCategory, closeDb } from './helpers/db'

/**
 * Editor category scope, end to end against a real session.
 *
 * These exist because the fixture set had no EDITOR account: every editorial
 * E2E test signed in as the admin, so an EDITOR with no category assignments
 * getting a 403 on saving any categorised article shipped to production with
 * CI green. The unit and integration tests for the same rule mock the session,
 * which would not have caught it either.
 *
 * Each test saves an article back with the values it already has, so the tests
 * assert the authorization outcome without mutating fixture content.
 */

test.afterAll(async () => {
  await closeDb()
})

/** Saves the article back unchanged; returns the raw response for assertions. */
async function resaveArticle(
  request: import('@playwright/test').APIRequestContext,
  article: { id: string; title: string; content: string | null; excerpt: string | null }
) {
  return request.put(`/api/articles/${article.id}`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      title: article.title,
      content: article.content ?? '',
      excerpt: article.excerpt,
      status: 'PUBLISHED',
    },
  })
}

test.describe('an editor with no category assignments', () => {
  test.use({ storageState: EDITOR_GLOBAL_STORAGE })

  test('can save a categorised article', async ({ request }) => {
    const article = await findPublishedInCategory('news')
    expect(article, 'fixtures should contain a published News article').not.toBeNull()

    const res = await resaveArticle(request, article!)
    expect(
      res.status(),
      `saving a News article as an unassigned editor returned ${res.status()}: ${await res.text()}`
    ).toBe(200)
  })
})

test.describe('an editor scoped to Opinion', () => {
  test.use({ storageState: EDITOR_SCOPED_STORAGE })

  test('can save an article inside their category', async ({ request }) => {
    const article = await findPublishedInCategory('opinion')
    expect(article, 'fixtures should contain a published Opinion article').not.toBeNull()

    const res = await resaveArticle(request, article!)
    expect(res.status()).toBe(200)
  })

  test('is refused, with a specific reason, outside their category', async ({ request }) => {
    const article = await findPublishedInCategory('news')
    expect(article).not.toBeNull()

    const res = await resaveArticle(request, article!)
    expect(res.status()).toBe(403)

    // The point of the error contract: a caller can tell WHY it was refused.
    const body = await res.json()
    expect(body.code).toBe('CATEGORY_SCOPE_DENIED')
    expect(body.error).toMatch(/outside your assigned categories/i)
    expect(body.requestId, 'a request id makes the refusal traceable in logs').toBeTruthy()
  })
})
