import { pinnedContext } from './helpers/pinnedContext'
import { ADMIN_STORAGE } from './helpers/authStorage'
import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
assertSafeTestDatabaseHost(process.env.DATABASE_URL, 'DATABASE_URL')
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
const key = 'upgrade-discovery-fixture'
let authorId: string
let categoryId: string
const tagIds: string[] = []
const articleIds: string[] = []
test.beforeAll(async ({ browser }) => {
  authorId = (
    await db.user.create({
      data: {
        email: `${key}@example.test`,
        name: 'Discovery Author Fixture',
        slug: key,
        role: 'WRITER',
      },
    })
  ).id
  categoryId = (await db.category.findUniqueOrThrow({ where: { slug: 'analysis' } })).id
  for (const name of ['Discovery Politics', 'Discovery History'])
    tagIds.push(
      (await db.tag.create({ data: { name, slug: name.toLowerCase().replace(' ', '-') } })).id
    )
  for (let i = 0; i < 25; i++)
    articleIds.push(
      (
        await db.article.create({
          data: {
            title: `Discovery Title Fixture ${i}`,
            slug: `${key}-${i}`,
            content: '{}',
            authorId,
            categoryId,
            status: 'PUBLISHED',
            publishedAt: new Date(),
            tags: { create: (i === 0 ? tagIds : [tagIds[i % 2]]).map((tagId) => ({ tagId })) },
          },
        })
      ).id
    )
  // Direct DB fixtures bypass publication invalidation. Exercise the real API
  // once so this suite is independent of a prior warmed public topic cache.
  const admin = await pinnedContext(browser, { storageState: ADMIN_STORAGE })
  try {
    const refreshed = await admin.request.put(`/api/articles/${articleIds[0]}`, {
      data: { title: 'Discovery Title Fixture 0' },
    })
    expect(refreshed.status(), await refreshed.text()).toBe(200)
  } finally {
    await admin.close()
  }
})
test.afterAll(async () => {
  await db.article.deleteMany({ where: { id: { in: articleIds } } })
  await db.tag.deleteMany({ where: { id: { in: tagIds } } })
  await db.user.delete({ where: { id: authorId } })
  await db.$disconnect()
})
for (const width of [375, 768, 1440]) {
  test(`topic OR, pagination, unselect, clear and refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const failed: string[] = []
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
    })
    await page.goto('/archive')
    await page.getByRole('checkbox', { name: 'Discovery Politics', exact: true }).check()
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page).toHaveURL(/tag=discovery-politics/)
    expect(await page.locator('a[href*="upgrade-discovery-fixture-"]').count()).toBe(13)
    await page.getByRole('checkbox', { name: 'Discovery History', exact: true }).check()
    await page.getByRole('combobox', { name: 'Article format' }).selectOption('analysis')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page.locator('a[href*="upgrade-discovery-fixture-"]')).toHaveCount(20)
    await page.getByRole('link', { name: 'Next page', exact: true }).click()
    await expect(page.locator('a[href*="upgrade-discovery-fixture-"]')).toHaveCount(5)
    await page.reload()
    await expect(
      page.getByRole('checkbox', { name: 'Discovery Politics', exact: true })
    ).toBeChecked()
    await expect(
      page.getByRole('checkbox', { name: 'Discovery History', exact: true })
    ).toBeChecked()
    await page.getByRole('checkbox', { name: 'Discovery History', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page).not.toHaveURL(/page=/)
    await expect(
      page.getByRole('checkbox', { name: 'Discovery History', exact: true })
    ).not.toBeChecked()
    await page.getByRole('link', { name: 'Clear all filters', exact: true }).click()
    await expect(page).toHaveURL(/\/archive$/)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    expect(errors).toEqual([])
    expect(failed).toEqual([])
  })
}
test('keyboard search discovers title, author, topic, empty and no results; failure can retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/search')
  const input = page.getByRole('searchbox', { name: 'Search articles, authors and topics' })
  await expect(page.getByText('Enter at least two characters')).toBeVisible()
  await input.fill('Discovery Title Fixture')
  await input.press('Enter')
  await expect(page.locator('a[href*="upgrade-discovery-fixture-"]').first()).toBeVisible()
  await input.fill('Discovery Author Fixture')
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Discovery Author Fixture', exact: true }).first()
  ).toBeVisible()
  await input.fill('Discovery History')
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Topics', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Discovery History', exact: true })).toBeVisible()
  await input.fill('unfindable-fixture-xyz')
  await input.press('Enter')
  await expect(page.getByText('No results for')).toBeVisible()
  await page.route('**/api/search?**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } })
  )
  await input.fill('Discovery Title Fixture')
  await input.press('Enter')
  await expect(page.locator('main [role=alert]')).toContainText('Search is temporarily unavailable')
  await page.unroute('**/api/search?**')
  await page.getByRole('button', { name: 'Retry search' }).click()
  await expect(page.locator('a[href*="upgrade-discovery-fixture-"]').first()).toBeVisible()
})

test('published topic assignments invalidate warm topic lists and follow unpublish/trash/restore', async ({
  browser,
}) => {
  const admin = await pinnedContext(browser, { storageState: ADMIN_STORAGE })
  const page = await browser.newPage()
  const marker = `Upgrade cache ${Date.now()}`,
    first = `${marker} Finance`,
    second = `${marker} Policy`
  const firstSlug = first.toLowerCase().replaceAll(' ', '-'),
    secondSlug = second.toLowerCase().replaceAll(' ', '-')
  let id = ''
  try {
    await page.goto('/archive')
    await expect(page.getByRole('checkbox', { name: first, exact: true })).toHaveCount(0)
    const created = await admin.request.post('/api/articles', {
      data: {
        title: marker,
        content: 'A topic cache contract.',
        categoryId,
        status: 'PUBLISHED',
        tags: [first],
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    id = (await created.json()).id
    await page.reload()
    await expect(page.getByRole('checkbox', { name: first, exact: true })).toBeVisible()
    await page.goto(`/tag/${firstSlug}`)
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible()
    expect(
      (
        await admin.request.put(`/api/articles/${id}`, {
          data: { tags: [second, ` ${second.toUpperCase()} `] },
        })
      ).status()
    ).toBe(200)
    expect(await db.articleTag.count({ where: { articleId: id } })).toBe(1)
    await page.reload()
    await expect(page.getByRole('heading', { name: marker, exact: true })).toHaveCount(0)
    await page.goto('/archive')
    await expect(page.getByRole('checkbox', { name: first, exact: true })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: second, exact: true })).toBeVisible()
    await page.goto(`/tag/${secondSlug}`)
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible()
    expect(
      (
        await admin.request.patch(`/api/editorial/articles/${id}/review`, {
          data: { action: 'unpublish' },
        })
      ).status()
    ).toBe(200)
    await page.reload()
    await expect(page.getByRole('heading', { name: marker, exact: true })).toHaveCount(0)
    expect(
      (await admin.request.put(`/api/articles/${id}`, { data: { status: 'PUBLISHED', publicationIntent: true } })).status()
    ).toBe(200)
    expect((await admin.request.delete(`/api/articles/${id}`)).status()).toBe(200)
    await page.reload()
    await expect(page.getByRole('heading', { name: marker, exact: true })).toHaveCount(0)
    expect((await admin.request.patch(`/api/editorial/trash/${id}`)).status()).toBe(200)
    await page.reload()
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible()
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await db.tag.deleteMany({ where: { name: { in: [first, second] } } })
    await page.close()
    await admin.close()
  }
})
