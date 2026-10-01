import { test, expect, request } from '@playwright/test'
import { ADMIN_STORAGE, WRITER_STORAGE } from './helpers/authStorage'

/**
 * End-to-end coverage of the article publication pipeline, against a real
 * running server, real session cookies, and a real (seeded, isolated) DB —
 * the one gap the September 2026 publication-pipeline audit called out
 * explicitly: no single test exercises the full lifecycle across every seam.
 *
 * Multiple roles are needed within the same scenario (writer, editor,
 * anonymous public visitor), so this spec manages its own per-role API
 * contexts via `request.newContext()` rather than one project-level
 * storageState, following the same request-driven style as
 * editor-scope.spec.ts.
 */

const PORT = process.env.E2E_PORT ?? '3000'
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

function uniqueTitle(label: string) {
  return `E2E ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const DOC = (text: string) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

test.describe('full article lifecycle', () => {
  test('draft → submit → return → edit/resubmit → publish → public → unpublish → gone', async ({ page }) => {
    const writer = await request.newContext({ baseURL: BASE_URL, storageState: WRITER_STORAGE })
    const admin = await request.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE })

    try {
      // 1. Writer creates a draft.
      const title = uniqueTitle('lifecycle')
      const createRes = await writer.post('/api/articles', {
        data: { title, content: DOC('First draft.'), status: 'DRAFT' },
      })
      expect(createRes.status(), await createRes.text()).toBe(201)
      const draft = await createRes.json()
      expect(draft.status).toBe('DRAFT')

      // 2. Writer submits for review.
      const submitRes = await writer.put(`/api/articles/${draft.id}`, {
        data: { title, content: draft.content, status: 'PENDING_REVIEW' },
      })
      expect(submitRes.status(), await submitRes.text()).toBe(200)
      expect((await submitRes.json()).status).toBe('PENDING_REVIEW')

      // 3. Editor returns it with feedback.
      const returnRes = await admin.patch(`/api/editorial/articles/${draft.id}/review`, {
        data: { action: 'return', note: 'Please add a source for the headline claim.' },
      })
      expect(returnRes.status(), await returnRes.text()).toBe(200)
      const returned = await returnRes.json()
      expect(returned.status).toBe('REJECTED')
      expect(returned.editorNote).toMatch(/source/i)

      // 4. Writer edits and resubmits — the editor note must clear on resubmit.
      const resubmitRes = await writer.put(`/api/articles/${draft.id}`, {
        data: { title, content: DOC('Revised draft with a cited source.'), status: 'PENDING_REVIEW' },
      })
      expect(resubmitRes.status(), await resubmitRes.text()).toBe(200)
      const resubmitted = await resubmitRes.json()
      expect(resubmitted.status).toBe('PENDING_REVIEW')
      expect(resubmitted.editorNote).toBeNull()

      // 5. Editor approves/publishes.
      const approveRes = await admin.patch(`/api/editorial/articles/${draft.id}/review`, {
        data: { action: 'approve' },
      })
      expect(approveRes.status(), await approveRes.text()).toBe(200)
      const published = await approveRes.json()
      expect(published.status).toBe('PUBLISHED')
      expect(published.publishedAt).toBeTruthy()

      // 6. Verify the public, unauthenticated article page actually renders it.
      await page.context().clearCookies()
      await page.goto(`/articles/${published.slug}`)
      await expect(page.locator('h1')).toContainText(title)

      // 7. Editor unpublishes.
      const unpublishRes = await admin.patch(`/api/editorial/articles/${draft.id}/review`, {
        data: { action: 'unpublish' },
      })
      expect(unpublishRes.status(), await unpublishRes.text()).toBe(200)
      expect((await unpublishRes.json()).status).toBe('DRAFT')

      // 8. The same public URL must now be gone.
      const afterRes = await page.goto(`/articles/${published.slug}`)
      expect(afterRes?.status()).toBe(404)

      // Cleanup: soft-delete the fixture article.
      await admin.delete(`/api/articles/${draft.id}`)
    } finally {
      await writer.dispose()
      await admin.dispose()
    }
  })

  test('editor can schedule a reviewed article for a future publish time', async () => {
    const writer = await request.newContext({ baseURL: BASE_URL, storageState: WRITER_STORAGE })
    const admin = await request.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE })

    try {
      const title = uniqueTitle('scheduled')
      const createRes = await writer.post('/api/articles', {
        data: { title, content: DOC('Scheduled piece.'), status: 'PENDING_REVIEW' },
      })
      expect(createRes.status(), await createRes.text()).toBe(201)
      const draft = await createRes.json()
      expect(draft.status).toBe('PENDING_REVIEW')

      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      const scheduledAt = future.toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm

      const scheduleRes = await admin.patch(`/api/editorial/articles/${draft.id}/review`, {
        data: { action: 'schedule', scheduledAt },
      })
      expect(scheduleRes.status(), await scheduleRes.text()).toBe(200)
      const scheduled = await scheduleRes.json()
      expect(scheduled.status).toBe('SCHEDULED')
      expect(scheduled.scheduledAt).toBeTruthy()
      expect(new Date(scheduled.scheduledAt).getTime()).toBeGreaterThan(Date.now())

      await admin.delete(`/api/articles/${draft.id}`)
    } finally {
      await writer.dispose()
      await admin.dispose()
    }
  })

  test('an illegal review transition is rejected with a structured 409', async () => {
    const writer = await request.newContext({ baseURL: BASE_URL, storageState: WRITER_STORAGE })
    const admin = await request.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE })

    try {
      // A fresh DRAFT was never submitted — "approve" has no legal source state.
      const title = uniqueTitle('invalid-transition')
      const createRes = await writer.post('/api/articles', {
        data: { title, content: DOC('Never submitted.'), status: 'DRAFT' },
      })
      expect(createRes.status(), await createRes.text()).toBe(201)
      const draft = await createRes.json()
      expect(draft.status).toBe('DRAFT')

      const approveRes = await admin.patch(`/api/editorial/articles/${draft.id}/review`, {
        data: { action: 'approve' },
      })
      expect(approveRes.status()).toBe(409)
      const body = await approveRes.json()
      expect(body.code).toBe('INVALID_STATUS_TRANSITION')

      await admin.delete(`/api/articles/${draft.id}`)
    } finally {
      await writer.dispose()
      await admin.dispose()
    }
  })

  test('inline article comments can be created and read back (article_comments table)', async () => {
    const writer = await request.newContext({ baseURL: BASE_URL, storageState: WRITER_STORAGE })
    const admin = await request.newContext({ baseURL: BASE_URL, storageState: ADMIN_STORAGE })

    try {
      const title = uniqueTitle('inline-comment')
      const createRes = await writer.post('/api/articles', {
        data: { title, content: DOC('Draft under review.'), status: 'PENDING_REVIEW' },
      })
      expect(createRes.status(), await createRes.text()).toBe(201)
      const draft = await createRes.json()

      const postRes = await admin.post(`/api/articles/${draft.id}/comments`, {
        data: { commentText: 'Can you add a citation here?' },
      })
      expect(postRes.status(), await postRes.text()).toBe(201)
      const created = await postRes.json()
      expect(created.commentText).toBe('Can you add a citation here?')
      expect(created.articleId).toBe(draft.id)

      const listRes = await admin.get(`/api/articles/${draft.id}/comments`)
      expect(listRes.status(), await listRes.text()).toBe(200)
      const comments = await listRes.json()
      expect(comments.map((c: { id: string }) => c.id)).toContain(created.id)

      await admin.delete(`/api/articles/${draft.id}`)
    } finally {
      await writer.dispose()
      await admin.dispose()
    }
  })
})
