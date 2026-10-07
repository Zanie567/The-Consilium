import { test, expect } from '@playwright/test'
import { PrismaClient, type ArticleStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'node:crypto'
import { ADMIN_STORAGE } from './helpers/authStorage'
import { resolveTestDatabaseUrl } from '../../scripts/lib/testDatabase'
import { collectConsoleErrors } from './helpers/console'
import { confirmPublicChange } from './helpers/workflow'

test.use({ storageState: ADMIN_STORAGE })
let db: PrismaClient
let ids: string[]
let seriesIds: string[]
test.beforeEach(async () => { db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }) }); ids = []; seriesIds = [] })
test.afterEach(async () => {
  await db.article.deleteMany({ where: { id: { in: ids } } })
  await db.series.deleteMany({ where: { id: { in: seriesIds } } })
  await db.$disconnect()
})
async function article(status: ArticleStatus) {
  const author = await db.user.findUniqueOrThrow({ where: { email: 'admin@theconsilium.com' } })
  const saved = await db.article.create({ data: { title: `Revision browser ${randomUUID()}`, slug: randomUUID(), content: 'Reviewed content', authorId: author.id, status } })
  ids.push(saved.id)
  return saved
}

test('list publish/unpublish sends loaded revisions, propagates successful revision and reconciles stale conflicts', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const serverErrors: string[] = []
  page.on('response', res => { if (res.url().includes('/api/') && res.status() >= 500) serverErrors.push(res.url()) })
  const loaded = await article('DRAFT')
  await page.goto('/editorial/articles')
  let row = page.getByRole('row').filter({ hasText: loaded.title })
  const publishedResponse = page.waitForResponse(res => res.url().endsWith(`/api/articles/${loaded.id}`) && res.request().method() === 'PUT')
  await row.getByRole('button', { name: 'Publish', exact: true }).click()
  await confirmPublicChange(page, 'Publish now')
  const published = await publishedResponse
  expect(published.status()).toBe(200)
  expect(published.request().postDataJSON().expectedUpdatedAt).toBe(loaded.updatedAt.toISOString())
  let revision = (await published.json()).updatedAt
  for (const [name, endpoint] of [['Set as featured', 'feature'], ['Pin to category', 'pin']]) {
    const response = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/${endpoint}`) && res.request().method() === 'POST')
    await row.getByRole('button', { name, exact: true }).click()
    const result = await response
    expect(result.status()).toBe(200)
    expect(result.request().headers()['x-article-revision']).toBe(revision)
    revision = (await result.json()).updatedAt
  }
  const unpublishResponse = page.waitForResponse(res => res.url().endsWith(`/api/articles/${loaded.id}`) && res.request().method() === 'PUT')
  await row.getByRole('button', { name: 'Unpublish', exact: true }).click()
  await confirmPublicChange(page, 'Unpublish')
  const unpublished = await unpublishResponse
  expect(unpublished.status()).toBe(200)
  expect(unpublished.request().postDataJSON().expectedUpdatedAt).toBe(revision)
  for (const status of ['DRAFT', 'PUBLISHED'] as const) {
    const current = await db.article.update({ where: { id: loaded.id }, data: { status } })
    await page.reload()
    row = page.getByRole('row').filter({ hasText: current.title })
    await expect(row).toBeVisible()
    const newer = await db.article.update({ where: { id: loaded.id }, data: { content: `Newer ${status} content`, title: `Newer ${randomUUID()}`, updatedAt: new Date(Date.now() + 100) } })
    const response = page.waitForResponse(res => res.url().endsWith(`/api/articles/${loaded.id}`) && res.request().method() === 'PUT')
    await row.getByRole('button', { name: status === 'DRAFT' ? 'Publish' : 'Unpublish', exact: true }).click()
    await confirmPublicChange(page, status === 'DRAFT' ? 'Publish now' : 'Unpublish')
    expect((await response).status()).toBe(409)
    await expect(page.getByText(/another editor changed/i)).toBeVisible()
    expect(await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(newer)
    await expect(page.getByRole('row').filter({ hasText: newer.title })).toBeVisible()
  }
  expect(errors).toEqual(Array(2).fill(`Failed to load resource: the server responded with a status of 409 (Conflict) @ ${process.env.E2E_BASE_URL}/api/articles/${loaded.id}`))
  expect(serverErrors).toEqual([])
})

test('series assignment from stale page preserves newer article, reload then assigns successfully', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const loaded = await article('PUBLISHED')
  const series = await db.series.create({ data: { title: `Revision series ${randomUUID()}`, slug: randomUUID() } })
  seriesIds.push(series.id)
  await page.goto('/editorial/series')
  await page.getByRole('button', { name: new RegExp(series.title) }).click()
  await page.locator(`[id="assign-${series.id}"]`).selectOption(loaded.id)
  const newer = await db.article.update({ where: { id: loaded.id }, data: { content: 'New series content', updatedAt: new Date(Date.now() + 100) } })
  const conflict = page.waitForResponse(res => res.url().endsWith(`/api/articles/${loaded.id}`) && res.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  expect((await conflict).status()).toBe(409)
  await expect(page.getByText(/another editor changed this article/i)).toContainText(/fresh copy|reload/i)
  expect(await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(newer)
  await page.reload()
  await page.getByRole('button', { name: new RegExp(series.title) }).click()
  await page.locator(`[id="assign-${series.id}"]`).selectOption(loaded.id)
  const success = page.waitForResponse(res => res.url().endsWith(`/api/articles/${loaded.id}`) && res.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  expect((await success).status()).toBe(200)
  await expect.poll(async () => (await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).seriesId).toBe(series.id)
  expect(errors).toEqual([`Failed to load resource: the server responded with a status of 409 (Conflict) @ ${process.env.E2E_BASE_URL}/api/articles/${loaded.id}`])
})

test('review rejects stale page; commendation revision propagates to successful return', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const loaded = await article('PENDING_REVIEW')
  await page.goto(`/editorial/review/${loaded.id}`)
  await expect(page.getByRole('button', { name: 'Publish Now' })).toBeVisible()
  const newer = await db.article.update({ where: { id: loaded.id }, data: { content: 'Updated review content', updatedAt: new Date(Date.now() + 100) } })
  const conflict = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/review`) && res.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Publish Now' }).click()
  await confirmPublicChange(page, 'Publish now')
  expect((await conflict).status()).toBe(409)
  await expect(page.getByText(/changed since this page was loaded/i)).toBeVisible()
  expect(await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(newer)
  expect(await db.notification.count({ where: { articleId: loaded.id } })).toBe(0)
  await page.reload()
  await page.getByLabel('Editorial commendation (optional)').fill('Carefully sourced')
  const commendation = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/commendation`) && res.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Save commendation' }).click()
  const saved = await commendation
  expect(saved.status()).toBe(200)
  const revision = (await saved.json()).updatedAt
  await page.getByPlaceholder('What needs to be revised?').fill('Please update the sources')
  const returned = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/review`) && res.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Return to Writer' }).click()
  const result = await returned
  expect(result.status()).toBe(200)
  expect(result.request().postDataJSON().expectedUpdatedAt).toBe(revision)
  expect(await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).toMatchObject({ status: 'REJECTED', content: 'Updated review content', editorialCommendation: 'Carefully sourced', editorNote: 'Please update the sources' })
  expect(errors).toEqual([`Failed to load resource: the server responded with a status of 409 (Conflict) @ ${process.env.E2E_BASE_URL}/api/editorial/articles/${loaded.id}/review`])
})

for (const action of ['approve', 'schedule'] as const) {
  test(`review UI ${action} with current revision succeeds${action === 'approve' ? ', then unpublishes' : ''}`, async ({ page }) => {
    const errors = collectConsoleErrors(page)
    const loaded = await article('PENDING_REVIEW')
    await page.goto(`/editorial/review/${loaded.id}`)
    if (action === 'schedule') await page.locator('input[type="datetime-local"]').fill('2099-01-01T12:00')
    const response = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/review`) && res.request().method() === 'PATCH')
    await page.getByRole('button', { name: action === 'approve' ? 'Publish Now' : 'Schedule', exact: true }).click()
    await confirmPublicChange(page, action === 'approve' ? 'Publish now' : 'Schedule')
    const result = await response
    expect(result.status()).toBe(200)
    expect(result.request().postDataJSON().expectedUpdatedAt).toBe(loaded.updatedAt.toISOString())
    await expect.poll(async () => (await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).status).toBe(action === 'approve' ? 'PUBLISHED' : 'SCHEDULED')
    if (action === 'approve') {
      await page.goto(`/editorial/review/${loaded.id}`)
      const unpublish = page.waitForResponse(res => res.url().endsWith(`/${loaded.id}/review`) && res.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Unpublish', exact: true }).click()
      await confirmPublicChange(page, 'Unpublish')
      expect((await unpublish).status()).toBe(200)
      expect((await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).status).toBe('DRAFT')
    } else {
      expect((await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).scheduledAt!.toISOString()).toBe('2099-01-01T12:00:00.000Z')
    }
    expect(errors).toEqual([])
  })
}

test('public bookmark on/off and comment persist through actual UI', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const networkErrors: string[] = []
  page.on('response', res => { if (res.url().includes('/api/') && res.status() >= 400) networkErrors.push(`${res.status()} ${res.url()}`) })
  const loaded = await article('PUBLISHED')
  await page.goto(`/articles/${loaded.slug}`)
  await page.getByRole('button', { name: 'Save article', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove bookmark', exact: true })).toBeVisible()
  expect(await db.bookmark.count({ where: { articleId: loaded.id } })).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: 'Remove bookmark', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
  expect(await db.bookmark.count({ where: { articleId: loaded.id } })).toBe(0)
  await page.getByPlaceholder('Join the discussion…').fill('A useful sourced discussion')
  const comment = page.waitForResponse(res => res.url().endsWith('/api/comments') && res.request().method() === 'POST')
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  expect((await comment).status()).toBe(201)
  expect(await db.comment.count({ where: { articleId: loaded.id, body: 'A useful sourced discussion' } })).toBe(1)
  await page.reload()
  await expect(page.getByText('A useful sourced discussion', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  expect(networkErrors).toEqual([])
})

test('calendar drag uses displayed revision, rolls back stale move, and reschedules after reload', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  const loaded = await article('SCHEDULED')
  await db.article.update({ where: { id: loaded.id }, data: { scheduledAt: new Date('2099-01-01T12:00:00Z') } })
  await page.goto('/editorial/calendar?month=2099-01')
  const chip = page.locator(`a[href="/editorial/articles/${loaded.id}/edit"][draggable="true"]`)
  await expect(chip).toBeVisible()
  const newer = await db.article.update({ where: { id: loaded.id }, data: { content: 'New calendar content', updatedAt: new Date(Date.now() + 100) } })
  const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date('2099-01-02T00:00:00Z'))
  const target = page.getByRole('button', { name: new RegExp(`^${dayLabel},`) })
  const conflict = page.waitForResponse(res => res.url().endsWith('/api/editorial/calendar') && res.request().method() === 'PATCH')
  await chip.dragTo(target)
  expect((await conflict).status()).toBe(409)
  await expect(page.getByText(/changed since this page was loaded/i)).toBeVisible()
  expect(await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(newer)
  await page.reload()
  const success = page.waitForResponse(res => res.url().endsWith('/api/editorial/calendar') && res.request().method() === 'PATCH')
  await chip.dragTo(target)
  const response = await success
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON().expectedUpdatedAt).toBe(newer.updatedAt.toISOString())
  await expect.poll(async () => (await db.article.findUniqueOrThrow({ where: { id: loaded.id } })).scheduledAt!.toISOString()).toBe('2099-01-02T12:00:00.000Z')
  expect(errors).toEqual([`Failed to load resource: the server responded with a status of 409 (Conflict) @ ${process.env.E2E_BASE_URL}/api/editorial/calendar`])
})
