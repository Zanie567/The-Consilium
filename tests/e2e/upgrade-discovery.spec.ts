import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
assertSafeTestDatabaseHost(process.env.DATABASE_URL, 'DATABASE_URL')
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const key = 'upgrade-discovery-fixture'
let authorId: string
let categoryId: string
const tagIds: string[] = []
const articleIds: string[] = []
test.beforeAll(async () => {
  authorId = (await db.user.create({ data: { email: `${key}@example.test`, name: 'Discovery Author Fixture', slug: key, role: 'WRITER' } })).id
  categoryId = (await db.category.findUniqueOrThrow({ where: { slug: 'analysis' } })).id
  for (const name of ['Discovery Politics', 'Discovery History']) tagIds.push((await db.tag.create({ data: { name, slug: name.toLowerCase().replace(' ', '-') } })).id)
  for (let i = 0; i < 25; i++) articleIds.push((await db.article.create({ data: { title: `Discovery Title Fixture ${i}`, slug: `${key}-${i}`,
    content: '{}', authorId, categoryId, status: 'PUBLISHED', publishedAt: new Date(),
    tags: { create: (i === 0 ? tagIds : [tagIds[i % 2]]).map(tagId => ({ tagId })) } } })).id)
})
test.afterAll(async () => {
  await db.article.deleteMany({ where: { id: { in: articleIds } } })
  await db.tag.deleteMany({ where: { id: { in: tagIds } } })
  await db.user.delete({ where: { id: authorId } }); await db.$disconnect()
})
for (const width of [375, 768, 1440]) {
  test(`topic OR, pagination, unselect, clear and refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const failed: string[] = []
    page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
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
    await expect(page.getByRole('checkbox', { name: 'Discovery Politics', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Discovery History', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'Discovery History', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(page).not.toHaveURL(/page=/)
    await expect(page.getByRole('checkbox', { name: 'Discovery History', exact: true })).not.toBeChecked()
    await page.getByRole('link', { name: 'Clear all filters', exact: true }).click()
    await expect(page).toHaveURL(/\/archive$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([]); expect(failed).toEqual([])
  })
}
test('keyboard search discovers title, author, topic, empty and no results; failure can retry', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/search')
  const input = page.getByRole('searchbox', { name: 'Search articles, authors and topics' })
  await expect(page.getByText('Enter at least two characters')).toBeVisible()
  await input.fill('Discovery Title Fixture'); await input.press('Enter')
  await expect(page.locator('a[href*="upgrade-discovery-fixture-"]').first()).toBeVisible()
  await input.fill('Discovery Author Fixture'); await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Authors', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Discovery Author Fixture', exact: true }).first()).toBeVisible()
  await input.fill('Discovery History'); await input.press('Enter')
  await expect(page.getByRole('heading', { name: 'Topics', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Discovery History', exact: true })).toBeVisible()
  await input.fill('unfindable-fixture-xyz'); await input.press('Enter')
  await expect(page.getByText('No results for')).toBeVisible()
  await page.route('**/api/search?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await input.fill('Discovery Title Fixture'); await input.press('Enter')
  await expect(page.locator('main [role=alert]')).toContainText('Search is temporarily unavailable')
  await page.unroute('**/api/search?**')
  await page.getByRole('button', { name: 'Retry search' }).click()
  await expect(page.locator('a[href*="upgrade-discovery-fixture-"]').first()).toBeVisible()
})
