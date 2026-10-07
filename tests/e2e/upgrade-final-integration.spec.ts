import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID, randomInt } from 'node:crypto'
import type { Role } from '@prisma/client'
import { ADMIN_STORAGE, EDITOR_GLOBAL_STORAGE, WRITER_STORAGE } from './helpers/authStorage'
import { resolveTestDatabaseUrl } from '../../scripts/lib/testDatabase'

test('concurrent editorial approvals commit one transition and one notification', async ({ browser }) => {
  const baseURL = process.env.E2E_BASE_URL!
  const writer = await browser.newContext({ storageState: WRITER_STORAGE, baseURL })
  const editor = await browser.newContext({ storageState: EDITOR_GLOBAL_STORAGE, baseURL })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL })
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }) })
  let id = ''
  try {
    const created = await writer.request.post('/api/articles', { data: {
      title: `Concurrent review ${Date.now()}`, content: 'A sourced article.', status: 'DRAFT',
    } })
    expect(created.status()).toBe(201)
    id = (await created.json()).id
    expect((await writer.request.put(`/api/articles/${id}`, { data: { status: 'PENDING_REVIEW' } })).status()).toBe(200)
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      editor.request.patch(`/api/editorial/articles/${id}/review`, { data: { action: 'approve' } })))
    const statuses = responses.map(response => response.status())
    expect(statuses.filter(status => status === 200), JSON.stringify(statuses)).toHaveLength(1)
    expect(statuses.filter(status => status === 409)).toHaveLength(7)
    expect(await db.notification.count({ where: { articleId: id, type: 'approve' } })).toBe(1)
    expect((await db.article.findUniqueOrThrow({ where: { id } })).status).toBe('PUBLISHED')
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await db.$disconnect()
    await Promise.all([writer.close(), editor.close(), admin.close()])
  }
})

test('concurrent writer submissions notify the review queue once and reject later writer edits', async ({ browser }) => {
  const baseURL = process.env.E2E_BASE_URL!
  const writer = await browser.newContext({ storageState: WRITER_STORAGE, baseURL })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL })
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }) })
  let id = ''
  try {
    const created = await writer.request.post('/api/articles', { data: {
      title: `Concurrent submission ${Date.now()}`, content: 'Draft content', status: 'DRAFT',
    } })
    expect(created.status()).toBe(201)
    id = (await created.json()).id
    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      writer.request.put(`/api/articles/${id}`, { data: { status: 'PENDING_REVIEW' } })))
    const statuses = responses.map(response => response.status())
    expect(statuses.filter(status => status === 200), JSON.stringify(statuses)).toHaveLength(1)
    expect(statuses.every(status => [200, 400, 409].includes(status))).toBe(true)
    const notifications = await db.notification.findMany({ where: { articleId: id, type: 'article_submitted' } })
    expect(notifications.length).toBeGreaterThan(0)
    expect(new Set(notifications.map(notification => notification.userId)).size).toBe(notifications.length)
    expect((await writer.request.put(`/api/articles/${id}`, { data: { content: 'Unauthorised post-submission edit' } })).status()).toBe(400)
    expect((await db.article.findUniqueOrThrow({ where: { id } })).content).toBe('Draft content')
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await db.$disconnect()
    await Promise.all([writer.close(), admin.close()])
  }
})

test('large pasted tables survive save/reload/publication and scroll within the mobile article', async ({ browser }) => {
  test.setTimeout(90000)
  const baseURL = process.env.E2E_BASE_URL!
  const writer = await browser.newContext({ storageState: WRITER_STORAGE, baseURL })
  const editor = await browser.newContext({ storageState: EDITOR_GLOBAL_STORAGE, baseURL })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL })
  const page = await writer.newPage()
  const reader = await browser.newPage()
  let id = ''
  try {
    await page.goto(`${baseURL}/editorial/articles/new`)
    await page.getByPlaceholder('Your headline here...').fill(`Large table preservation ${Date.now()}`)
    const html = `<table>${Array.from({ length: 501 }, (_, i) => `<tr><td>Row ${i}</td></tr>`).join('')}</table><p>Between tables.</p><table><tr>${Array.from({ length: 101 }, (_, i) => `<td>Column ${i}</td>`).join('')}</tr></table>`
    await expect(page.locator('.ProseMirror')).toBeVisible()
    await page.locator('.ProseMirror').evaluate((element, html) => {
      const data = new DataTransfer()
      data.setData('text/html', html)
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, html)
    await expect(page.locator('.ProseMirror table').first().locator('tr')).toHaveCount(501)
    const saved = page.waitForResponse(response => response.url().includes('/api/articles') && response.request().method() === 'POST' && response.ok())
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    id = (await (await saved).json()).id
    await page.goto(`${baseURL}/editorial/articles/${id}/edit`)
    await expect(page.locator('.ProseMirror table').first().locator('tr')).toHaveCount(501)
    await expect(page.locator('.ProseMirror table').nth(1).locator('td')).toHaveCount(101)
    expect((await writer.request.put(`/api/articles/${id}`, { data: { status: 'PENDING_REVIEW' } })).status()).toBe(200)
    const published = await editor.request.patch(`/api/editorial/articles/${id}/review`, { data: { action: 'approve' } })
    expect(published.status()).toBe(200)
    const slug = (await published.json()).slug
    await reader.setViewportSize({ width: 375, height: 812 })
    await reader.goto(`${baseURL}/articles/${slug}`)
    await expect(reader.locator('.prose-consilium table').first().locator('tr')).toHaveCount(501)
    await expect(reader.locator('.prose-consilium table').nth(1).locator('td')).toHaveCount(101)
    await expect(reader.getByText('Row 500', { exact: true })).toHaveCount(1)
    const scroll = reader.locator('.prose-consilium .table-scroll').nth(1)
    await scroll.focus()
    await reader.keyboard.press('ArrowRight')
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await reader.close()
    await Promise.all([writer.close(), editor.close(), admin.close()])
  }
})

test('shuffled account-linked chief, two deputies, editors, writers and Growth render in order; one deputy stays centred', async ({ page }) => {
  test.setTimeout(60000)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }) })
  const original = await db.teamMember.findMany({ where: { isActive: true }, select: { id: true } })
  const users: string[] = []
  const roster: { name: string; title: string; role: Role; order: number }[] = [
    { name: 'QA Chief', title: 'Editor-in-Chief', role: 'EDITOR', order: 0 },
    { name: 'QA Deputy A', title: 'Deputy Editor-in-Chief', role: 'EDITOR', order: 0 },
    { name: 'QA Deputy B', title: 'Deputy Editor-in-Chief', role: 'EDITOR', order: 1 },
    ...[1, 2, 3].map(i => ({ name: `QA Editor ${i}`, title: 'Editor', role: 'EDITOR' as const, order: i })),
    ...[1, 2].map(i => ({ name: `QA Writer ${i}`, title: 'Writer', role: 'WRITER' as const, order: i })),
    ...[1, 2].map(i => ({ name: `QA Growth ${i}`, title: 'Growth & Comms', role: 'GROWTH' as const, order: i })),
  ]
  for (let i = roster.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[roster[i], roster[j]] = [roster[j], roster[i]]
  }
  try {
    await db.teamMember.updateMany({ where: { id: { in: original.map(row => row.id) } }, data: { isActive: false } })
    for (const member of roster) {
      const user = await db.user.create({ data: { name: member.name, role: member.role, email: `${randomUUID()}@team-qa.example.test` } })
      users.push(user.id)
      await db.teamMember.create({ data: { userId: user.id, name: member.name, role: member.title, publicTier: member.role === 'GROWTH' ? 'growth' : null, order: member.order, bio: 'Integration QA profile' } })
    }
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/team')
      const decline = page.getByRole('button', { name: 'Decline', exact: true })
      if (await decline.isVisible()) await decline.click()
      await expect(page.locator('main h3')).toHaveText([
        'QA Chief', 'QA Deputy A', 'QA Deputy B', 'QA Editor 1', 'QA Editor 2', 'QA Editor 3', 'QA Writer 1', 'QA Writer 2', 'QA Growth 1', 'QA Growth 2',
      ])
      await expect(page.getByRole('heading', { name: 'Editorial Team', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Writers', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Growth & Comms', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const card of await page.getByRole('button', { name: /^View full profile for QA/ }).all()) {
        await card.scrollIntoViewIfNeeded()
        await expect(card.locator('..').locator('..')).toHaveCSS('opacity', '1')
        await expect(card.locator('..').locator('..')).toHaveCSS('transform', 'none')
      }
      if (width === 1440) {
        const positions = await page.getByRole('button', { name: /^View full profile for QA Deputy/ }).evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y } }))
        expect(positions[0].y).toBe(positions[1].y)
        expect(positions[0].x).toBeLessThan(positions[1].x)
      }
      await page.getByRole('heading', { name: 'Our Team', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('heading', { name: 'Our Team', exact: true }).locator('..')).toHaveCSS('opacity', '1')
      await page.screenshot({ path: test.info().outputPath(`${width}-mixed-team.png`), fullPage: true })
    }
    await db.teamMember.deleteMany({ where: { userId: { in: users }, name: 'QA Deputy B' } })
    await page.reload()
    await expect(page.getByRole('button', { name: /^View full profile for QA Deputy/ })).toHaveCount(1)
    const centre = await page.getByRole('button', { name: 'View full profile for QA Deputy A', exact: true }).evaluate(element => { const rect = element.getBoundingClientRect(); return rect.x + rect.width / 2 })
    expect(Math.abs(centre - 720)).toBeLessThan(15)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    for (const card of await page.getByRole('button', { name: /^View full profile for QA/ }).all())
      await expect(card.locator('..').locator('..')).toHaveCSS('opacity', '1')
    await expect(page.getByRole('heading', { name: 'Our Team', exact: true }).locator('..')).toHaveCSS('opacity', '1')
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } })
    await db.teamMember.updateMany({ where: { id: { in: original.map(row => row.id) } }, data: { isActive: true } })
    await db.$disconnect()
  }
})

test('an editor with a stale open document gets a conflict and retains unsaved changes', async ({ browser }) => {
  const baseURL = process.env.E2E_BASE_URL!
  const first = await browser.newContext({ storageState: EDITOR_GLOBAL_STORAGE, baseURL })
  const second = await browser.newContext({ storageState: EDITOR_GLOBAL_STORAGE, baseURL })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL })
  let id = ''
  try {
    const created = await admin.request.post('/api/articles', { data: { title: `Revision fixture ${Date.now()}`, content: 'Initial content', status: 'PUBLISHED' } })
    expect(created.status()).toBe(201)
    const initial = await created.json()
    id = initial.id
    const a = await first.newPage(), b = await second.newPage()
    await a.goto(`/editorial/articles/${id}/edit`)
    await b.goto(`/editorial/articles/${id}/edit`)
    await expect(b.locator('.ProseMirror')).toBeVisible()
    await expect(a.getByPlaceholder('Your headline here...')).toHaveCount(1)
    await expect(b.getByPlaceholder('Your headline here...')).toHaveCount(1)
    expect((await admin.request.post('/api/analytics/track', { data: { articleId: id, sessionId: randomUUID(), visitId: randomUUID() } })).status()).toBe(200)
    const afterView = await (await admin.request.get(`/api/articles/${id}`)).json()
    expect(afterView.viewCount).toBe(1)
    expect(afterView.updatedAt).toBe(initial.updatedAt)
    await a.getByPlaceholder('Your headline here...').fill('First editor committed this title')
    const committed = a.waitForResponse(response => response.url().includes(`/api/articles/${id}`) && response.request().method() === 'PUT')
    await a.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await committed).status()).toBe(200)
    await expect(b.getByPlaceholder('Your headline here...')).toHaveCount(1)
    await b.getByPlaceholder('Your headline here...').fill('Second editor unsaved title')
    const rejected = b.waitForResponse(response => response.url().includes(`/api/articles/${id}`) && response.request().method() === 'PUT')
    await b.getByRole('button', { name: 'Save draft', exact: true }).click()
    expect((await rejected).status()).toBe(409)
    await expect(b.getByText(/This article was changed in another tab or by another editor/).first()).toBeVisible()
    await expect(b.getByRole('button', { name: 'Keep my version', exact: true })).toBeVisible()
    await expect(b.getByRole('button', { name: 'Discard mine and reload', exact: true })).toBeVisible()
    await expect(b.getByPlaceholder('Your headline here...')).toHaveValue('Second editor unsaved title')
    expect((await (await admin.request.get(`/api/articles/${id}`)).json()).title).toBe('First editor committed this title')
    await b.screenshot({ path: test.info().outputPath('stale-editor-conflict.png'), fullPage: true })
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await Promise.all([first.close(), second.close(), admin.close()])
  }
})

test('slow draft creation preserves newer typing, and a failed save retains changes for retry', async ({ browser }) => {
  const context = await browser.newContext({ storageState: WRITER_STORAGE, baseURL: process.env.E2E_BASE_URL! })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL: process.env.E2E_BASE_URL! })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const posting = new Promise<void>(resolve => { started = resolve })
  let id = ''
  try {
    const page = await context.newPage()
    await page.route('**/api/articles', async route => {
      if (route.request().method() === 'POST') { started(); await held }
      await route.continue()
    })
    await page.goto('/editorial/articles/new')
    const prefix = `Slow save ${Date.now()}`
    const headline = page.getByRole('textbox', { name: 'Untitled document', exact: true })
    const created = page.waitForResponse(response => response.url().endsWith('/api/articles') && response.request().method() === 'POST')
    await headline.fill(`${prefix} first snapshot`)
    await posting
    const newerSaved = page.waitForResponse(response => response.url().includes('/api/articles/') && response.request().method() === 'PUT' && response.status() === 200)
    await headline.fill(`${prefix} newer typing`)
    release()
    const response = await created
    expect(response.status()).toBe(201)
    id = (await response.json()).id
    await expect(page).toHaveURL(new RegExp(`/articles/${id}/edit$`))
    await expect(headline).toHaveValue(`${prefix} newer typing`)
    await newerSaved
    expect(await (await context.request.get(`/api/articles/${id}`)).json()).toMatchObject({ title: `${prefix} newer typing` })
    let failSave = true
    await page.route(`**/api/articles/${id}`, route => route.request().method() === 'PUT' && failSave
      ? route.fulfill({ status: 503, json: { error: 'Temporary local fixture outage' } })
      : route.continue())
    await headline.fill(`${prefix} retained after failure`)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'unsaved changes remain' })).toBeVisible()
    await expect(headline).toHaveValue(`${prefix} retained after failure`)
    expect(await (await context.request.get(`/api/articles/${id}`)).json()).toMatchObject({ title: `${prefix} newer typing` })
    failSave = false
    const retried = page.waitForResponse(response => response.url().endsWith(`/api/articles/${id}`) && response.request().method() === 'PUT' && response.status() === 200)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await retried
    await page.reload()
    await expect(headline).toHaveValue(`${prefix} retained after failure`)
  } finally {
    release()
    if (id) { await admin.request.delete(`/api/articles/${id}`); await admin.request.delete(`/api/editorial/trash/${id}`) }
    await context.close()
    await admin.close()
  }
})

test('document settings expose one desktop form and trap/restore keyboard focus on mobile', async ({ browser }) => {
  const context = await browser.newContext({ storageState: WRITER_STORAGE, baseURL: process.env.E2E_BASE_URL!, viewport: { width: 1440, height: 900 } })
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE, baseURL: process.env.E2E_BASE_URL! })
  let id = ''
  try {
    const response = await context.request.post('/api/articles', { data: { title: `Settings focus ${Date.now()}`, content: 'Local test', status: 'DRAFT' } })
    expect(response.status()).toBe(201)
    id = (await response.json()).id
    const page = await context.newPage()
    await page.goto(`/editorial/articles/${id}/edit`)
    await expect(page.getByLabel('Article format', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: 'Document settings' })).toHaveCount(0)
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 })
      const opener = page.getByRole('button', { name: 'Document settings', exact: true })
      await opener.click()
      const dialog = page.getByRole('dialog', { name: 'Document settings' })
      await expect(dialog).toBeVisible()
      const close = dialog.getByRole('button', { name: 'Close settings' })
      await expect(close).toBeFocused()
      await close.press('Shift+Tab')
      await expect(dialog.getByLabel('Article topics')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`${width}-editor-settings.png`), fullPage: true })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    }
  } finally {
    if (id) {
      await admin.request.delete(`/api/articles/${id}`)
      await admin.request.delete(`/api/editorial/trash/${id}`)
    }
    await Promise.all([context.close(), admin.close()])
  }
})
