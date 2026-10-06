import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'node:crypto'
import { ADMIN_STORAGE, WRITER_STORAGE } from './helpers/authStorage'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
assertSafeTestDatabaseHost(process.env.DATABASE_URL, 'DATABASE_URL')
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
let id: string, slug: string, authorId: string
const email = `${randomUUID()}@example.test`
test.beforeAll(async () => {
  authorId = (
    await db.user.create({
      data: { email: `${randomUUID()}@example.test`, name: 'Engagement Writer', role: 'WRITER' },
    })
  ).id
  slug = `upgrade-growth-${randomUUID()}`
  id = (
    await db.article.create({
      data: {
        title: 'Growth and active reading fixture',
        slug,
        authorId,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Readers can share this economic analysis.' }],
            },
          ],
        }),
      },
    })
  ).id
})
test.afterAll(async () => {
  await db.subscriber.deleteMany({ where: { email } })
  await db.article.deleteMany({ where: { id } })
  await db.user.delete({ where: { id: authorId } })
  await db.$disconnect()
})

test('newsletter validates, retries network failure, normalizes and deduplicates at mobile width', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Newsletter email address' })
  await input.fill('invalid')
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
  expect(await input.evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false)
  await page.route('**/api/subscribe', (route) => route.abort(), { times: 1 })
  await input.fill(email.toUpperCase())
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to subscribe' })).toBeVisible()
  await page.getByRole('button', { name: 'Subscribe', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Thank you for subscribing')
  await page.reload()
  await input.fill(email)
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Thank you for subscribing')
  expect(await db.subscriber.count({ where: { email } })).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('canonical copy, clipboard fallback, LinkedIn, email and native sharing are keyboard accessible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          ;(window as unknown as { copied: string }).copied = text
        },
      },
      configurable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: async (data: unknown) => {
        ;(window as unknown as { shared: unknown }).shared = data
      },
      configurable: true,
    })
    window.open = ((url?: string | URL) => {
      ;(window as unknown as { opened: string }).opened = String(url)
      return null
    }) as typeof window.open
  })
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto(`/articles/${slug}`)
  const canonical = `https://theconsilium.co.uk/articles/${slug}`
  await page.getByRole('button', { name: 'Copy link', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Link copied')
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(
    canonical
  )
  await page.getByRole('button', { name: 'Share on LinkedIn', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { opened: string }).opened)).toContain(
    encodeURIComponent(canonical)
  )
  await expect(page.getByRole('link', { name: 'Share by email' })).toHaveAttribute(
    'href',
    `mailto:?subject=${encodeURIComponent('Growth and active reading fixture')}&body=${encodeURIComponent(canonical)}`
  )
  await page.getByRole('button', { name: 'Share article', exact: true }).click()
  expect(
    await page.evaluate(() => (window as unknown as { shared: { url: string } }).shared.url)
  ).toBe(canonical)
  await page.reload()
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
      configurable: true,
    })
  )
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Copy failed' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Article link' })).toHaveValue(canonical)
})

test('analytics heartbeat pauses hidden, consent controls persistence, failure leaves article readable', async ({
  page,
}) => {
  const events: { activeSeconds: number; readerId?: string; consent: boolean }[] = []
  await page.clock.install()
  await page.route('**/api/analytics/track', async (route) => {
    events.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, json: { ok: true } })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/articles/${slug}`)
  await expect(
    page.getByRole('heading', { name: 'Growth and active reading fixture', exact: true })
  ).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.clock.runFor(30000)
  expect(events.some((e) => e.activeSeconds >= 30 && !e.readerId)).toBe(true)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const seconds = events.at(-1)?.activeSeconds
  await page.clock.runFor(90000)
  expect(events.at(-1)?.activeSeconds).toBe(seconds)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('consilium_analytics_reader'))).toBeTruthy()
  await page.evaluate(() => {
    localStorage.setItem('consilium_cookie_consent', 'declined')
    window.dispatchEvent(new Event('consilium-consent-change'))
  })
  expect(await page.evaluate(() => localStorage.getItem('consilium_analytics_reader'))).toBeNull()
  expect(events.at(-1)?.readerId).toBeUndefined()
  await page.unroute('**/api/analytics/track')
  await page.route('**/api/analytics/track', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } })
  )
  await page.reload()
  await expect(page.getByText('Readers can share this economic analysis.')).toBeVisible()
  expect(errors).toEqual([])
})

test('existing analytics dashboard exposes active reading and rejects writer permissions', async ({
  browser,
}) => {
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE })
  const writer = await browser.newContext({ storageState: WRITER_STORAGE })
  const page = await admin.newPage()
  try {
    const rejected = await writer.request.get('/api/editorial/analytics?tab=engagement')
    expect(rejected.status()).toBe(401)
    await page.goto('/editorial/analytics')
    await page.getByRole('button', { name: 'Engagement', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Active reading', exact: true })).toBeVisible()
    await expect(page.getByText('Readers with 5 active minutes', { exact: true })).toBeVisible()
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
    }
  } finally {
    await admin.close()
    await writer.close()
  }
})

test('one publication LinkedIn setting updates footer/contact and refuses writer changes', async ({
  browser,
}) => {
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE })
  const writer = await browser.newContext({ storageState: WRITER_STORAGE })
  const page = await browser.newPage()
  const response = await admin.request.get('/api/editorial/growth/settings')
  expect(response.status()).toBe(200)
  const previous = (await response.json()).linkedinUrl
  try {
    expect(
      (
        await writer.request.patch('/api/editorial/growth/settings', {
          data: { linkedinUrl: 'https://www.linkedin.com/company/forged/' },
        })
      ).status()
    ).toBe(403)
    expect(
      (
        await admin.request.patch('/api/editorial/growth/settings', {
          data: { linkedinUrl: 'javascript:alert(1)' },
        })
      ).status()
    ).toBe(400)
    const fixture = 'https://www.linkedin.com/company/consilium-local-test-fixture/'
    expect(
      (
        await admin.request.patch('/api/editorial/growth/settings', {
          data: { linkedinUrl: fixture },
        })
      ).status()
    ).toBe(200)
    await page.goto('/contact')
    await expect(
      page.getByRole('link', { name: 'Connect with The Consilium on LinkedIn' })
    ).toHaveCount(2)
    for (const link of await page
      .getByRole('link', { name: 'Connect with The Consilium on LinkedIn' })
      .all()) {
      await expect(link).toHaveAttribute('href', fixture)
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    await page.goto('/editorial/growth/subscribers')
    // Use the authenticated existing Growth surface for configuration.
    const settings = await admin.newPage()
    await settings.goto('/editorial/growth/subscribers')
    await expect(settings.getByRole('textbox', { name: 'Publication LinkedIn URL' })).toHaveValue(
      fixture
    )
    await settings.getByRole('textbox', { name: 'Publication LinkedIn URL' }).fill('')
    await settings.getByRole('button', { name: 'Save publication links' }).click()
    await expect(settings.getByRole('status')).toContainText('Publication links saved')
    await settings.close()
    await page.goto('/contact')
    await page.reload()
    await expect(
      page.getByRole('link', { name: 'Connect with The Consilium on LinkedIn' })
    ).toHaveCount(0)
  } finally {
    await admin.request.patch('/api/editorial/growth/settings', { data: { linkedinUrl: previous } })
    await page.close()
    await admin.close()
    await writer.close()
  }
})
