import { test, expect, type Page } from '@playwright/test'
import { capturedEmails, closeDb, db, signedIn, withCookieConsentAnswered } from './helpers/workflow'

/**
 * Newsletter, driven as people use it. Email is captured to the run's outbox file; nothing is sent and no
 * marketing provider is reachable (the isolated stack forces capture).
 *   - a visitor subscribes, confirms from the emailed link (a button, never on page load), changes topics
 *     and unsubscribes;
 *   - an administrator previews, approves and cancels an edition; an editor cannot approve or resume
 *     sending; growth can look but not build;
 *   - the editorial pages work at phone width without sideways scrolling.
 */
test.describe.configure({ mode: 'serial' })

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const VISITOR = `visitor-${RUN}@newsletter-e2e.test`
const campaignIds: string[] = []

const noSidewaysScroll = async (page: Page, what: string) => {
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  expect(m.doc, `${what} scrolls sideways (${m.doc}px content in a ${m.win}px window)`).toBeLessThanOrEqual(m.win + 1)
}

async function seededDraft(editionKey: string) {
  const article = await db().article.findFirstOrThrow({ where: { status: 'PUBLISHED', deletedAt: null, publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, include: { author: true } })
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3200'
  const item = { id: article.id, slug: article.slug, title: article.title, author: article.author.name ?? 'The Consilium', summary: article.excerpt, sourceExcerpt: article.excerpt, imageUrl: null, imageAlt: '', url: `${base}/articles/${article.slug}`, category: null, publishedAt: article.publishedAt!.toISOString() }
  const created = await db().newsletterCampaign.create({
    data: { kind: 'WEEKLY', editionKey, status: 'DRAFT', subject: `E2E edition ${RUN}`, previewText: 'Preview text', articles: { items: [item], excluded: [] }, contentHash: `seed-${RUN}-${editionKey}`, createdByName: 'E2E' },
  })
  campaignIds.push(created.id)
  return created.id
}

test.afterAll(async () => {
  await db().newsletterCampaign.deleteMany({ where: { id: { in: campaignIds } } })
  const subs = await db().subscriber.findMany({ where: { email: { endsWith: '@newsletter-e2e.test' } }, select: { id: true } })
  await db().subscriberConsentEvent.deleteMany({ where: { subscriberId: { in: subs.map((s) => s.id) } } })
  await db().subscriber.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } })
  await db().auditLog.deleteMany({ where: { targetId: { in: campaignIds } } })
  await closeDb()
})

test('a visitor subscribes, confirms from the email, chooses topics and unsubscribes', async ({ browser }) => {
  const context = await withCookieConsentAnswered(await browser.newContext())
  const page = await context.newPage()
  await page.goto('/')
  const form = page.locator('section[aria-labelledby="newsletter-heading"]')
  await form.getByLabel('Newsletter email address').fill(VISITOR)
  await expect(form.getByLabel(/special-article alerts/i)).not.toBeChecked()
  await form.getByRole('button', { name: 'Subscribe' }).click()
  await expect(form.getByRole('status')).toContainText(/check your inbox/i)

  // Nothing is subscribed yet: only a confirmation was requested.
  await expect.poll(async () => (await db().subscriber.findFirst({ where: { email: VISITOR } }))?.status).toBe('PENDING')
  let mail: { html: string } | undefined
  await expect.poll(() => (mail = capturedEmails().find((m) => m.to === VISITOR))).toBeTruthy()
  const link = /href="([^"]+\/newsletter\/confirm\?token=[^"]+)"/.exec(mail!.html)?.[1]
  expect(link).toBeTruthy()

  // Opening the link (as a mail scanner would) confirms nothing.
  await page.goto(link!.replace(/&amp;/g, '&'))
  await expect(page.getByRole('heading', { name: 'Confirm your subscription' })).toBeVisible()
  expect((await db().subscriber.findFirst({ where: { email: VISITOR } }))?.status).toBe('PENDING')
  await page.getByRole('button', { name: 'Confirm my subscription' }).click()
  await expect(page.getByRole('status')).toContainText(/you are subscribed/i)
  expect((await db().subscriber.findFirst({ where: { email: VISITOR } }))?.status).toBe('ACTIVE')

  await page.getByRole('link', { name: 'Choose topics' }).click()
  await expect(page.getByRole('heading', { name: 'Newsletter preferences' })).toBeVisible()
  await expect(page.getByText(/^vi\*+@newsletter-e2e\.test$/)).toBeVisible()
  await page.getByRole('switch', { name: /special-article alerts/i }).check()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByRole('status')).toContainText('Your preferences are saved.')
  expect((await db().subscriber.findFirst({ where: { email: VISITOR } }))?.specialAlerts).toBe(true)

  await page.getByRole('button', { name: 'Unsubscribe from everything' }).click()
  await page.getByRole('button', { name: 'Yes, unsubscribe' }).click()
  await expect(page.getByRole('status')).toContainText(/you are unsubscribed/i)
  expect((await db().subscriber.findFirst({ where: { email: VISITOR } }))?.status).toBe('UNSUBSCRIBED')
  await expect(page.getByRole('button', { name: 'Subscribe again' })).toBeVisible()
  await context.close()
})

test('the old unsubscribe address never changes anything on page load', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/unsubscribe?email=${encodeURIComponent(VISITOR)}&token=${'0'.repeat(64)}`)
  await expect(page.getByRole('heading', { name: 'Unsubscribe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible()
  await context.close()
})

test('an administrator previews, approves and cancels an edition, with every step audited', async ({ browser }) => {
  const id = await seededDraft('weekly:2041-01-04')
  const context = await signedIn(browser, 'admin')
  const page = await context.newPage()
  await page.goto('/editorial/newsletter')
  await expect(page.getByRole('heading', { name: 'Newsletter', exact: true })).toBeVisible()
  await expect(page.getByText('Captured locally')).toBeVisible()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume sending' })).toBeVisible()

  await page.getByRole('link', { name: new RegExp(`E2E edition ${RUN}`) }).click()
  await expect(page).toHaveURL(new RegExp(`/editorial/newsletter/${id}$`))
  await expect(page.frameLocator('iframe[title="Email preview"]').getByText('The Consilium', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /mobile/i }).click()
  await expect(page.locator('iframe[title="Email preview"]')).toHaveAttribute('style', /375px/)

  await page.getByRole('button', { name: 'Approve this exact version' }).click()
  await expect(page.getByText('Approved and scheduled').first()).toBeVisible()
  await page.getByRole('button', { name: /Cancel this edition/ }).click()
  await page.getByLabel('Reason (kept in the audit trail)').fill('E2E check')
  await page.getByRole('button', { name: 'Confirm cancel' }).click()
  await expect(page.getByText('Cancelled').first()).toBeVisible()
  const audit = page.locator('ol').filter({ hasText: 'Approved and scheduled' })
  await expect(audit).toContainText('Cancelled')
  expect((await db().newsletterCampaign.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED')
  await context.close()
})

test('an editor can prepare but not approve, and cannot resume sending; growth can only look', async ({ browser }) => {
  const id = await seededDraft('weekly:2041-01-11')
  const editor = await signedIn(browser, 'editor')
  const page = await editor.newPage()
  await page.goto(`/editorial/newsletter/${id}`)
  await expect(page.getByText('An administrator approves and schedules the send.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this exact version' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Rebuild from published articles/ })).toBeVisible()
  const denied = await page.request.patch(`/api/editorial/newsletter/campaigns/${id}`, { data: { action: 'approve', expectedHash: 'x' } })
  expect(denied.status()).toBe(403)
  await page.goto('/editorial/newsletter')
  await expect(page.getByRole('button', { name: 'Resume sending' })).toHaveCount(0)
  await editor.close()

  const growth = await signedIn(browser, 'growth')
  const growthPage = await growth.newPage()
  await growthPage.goto('/editorial/newsletter')
  await expect(growthPage.getByRole('heading', { name: 'Newsletter', exact: true })).toBeVisible()
  await expect(growthPage.getByRole('button', { name: /Build this week/ })).toHaveCount(0)
  await growth.close()
})

test('the editorial newsletter pages fit a phone', async ({ browser }) => {
  const id = campaignIds[0]
  const context = await signedIn(browser, 'admin')
  const page = await context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/editorial/newsletter')
  await expect(page.getByRole('heading', { name: 'Newsletter', exact: true })).toBeVisible()
  await noSidewaysScroll(page, 'the newsletter overview')
  await page.goto(`/editorial/newsletter/${id}`)
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible()
  await noSidewaysScroll(page, 'the edition page')
  await context.close()
})
