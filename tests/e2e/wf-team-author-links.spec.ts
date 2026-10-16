import { test, expect, type Page } from '@playwright/test'
import { closeDb, createAccount, db, removeMyAccounts, removeMyArticles, uniqueTitle, type TestAccount } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Meet the Team → profile → "Read their articles" → the author's public articles.
 * The link follows published authorship, not role: a Senior Editor whose account has no
 * slug (as most production accounts) still gets it, via the author page's id fallback;
 * a writer with only a draft does not.
 */
test.afterAll(async () => {
  await removeMyArticles()
  await removeMyAccounts() // their team cards cascade with them
  await closeDb()
})

const paragraph = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] })

async function teamMember(role: 'EDITOR' | 'WRITER', label: string, title: string, publicTier: string) {
  const account = await createAccount(role, label)
  await db().user.update({ where: { id: account.id }, data: { slug: null } })
  await db().teamMember.create({
    data: { userId: account.id, name: account.name, role: title, publicTier, bio: `${account.name} writes about markets.`, order: 5000, isActive: true },
  })
  return account
}
async function article(author: TestAccount, status: 'PUBLISHED' | 'DRAFT', label: string) {
  const title = uniqueTitle(label)
  await db().article.create({
    data: { title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), content: paragraph, authorId: author.id, status, publishedAt: status === 'PUBLISHED' ? new Date() : null },
  })
  return title
}
async function openProfile(page: Page, name: string) {
  await page.goto('/team', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: `View full profile for ${name}` }).click()
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog).toBeVisible()
  return dialog
}

test('published team members link to their author page; unpublished ones do not', async ({ browser }) => {
  test.setTimeout(90_000)
  const editor = await teamMember('EDITOR', 'author-link-editor', 'Senior Editor', 'senior_editor')
  const published = await article(editor, 'PUBLISHED', 'Author link published')
  const unpublished = await article(editor, 'DRAFT', 'Author link draft')
  const writer = await teamMember('WRITER', 'author-link-writer', 'Writer', 'writer')
  await article(writer, 'DRAFT', 'Author link writer draft')

  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const errors = collectConsoleErrors(page)

  const writerDialog = await openProfile(page, writer.name)
  await expect(writerDialog.getByRole('link', { name: /read their articles/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(writerDialog).toHaveCount(0)

  const dialog = await openProfile(page, editor.name)
  const link = dialog.getByRole('link', { name: 'Read their articles →' })
  await expect(link).toHaveAttribute('href', `/author/${editor.id}`)
  await expect(link).toHaveCSS('text-transform', 'uppercase')
  await link.click()

  await expect(page).toHaveURL(new URL(`/author/${editor.id}`, page.url()).href)
  await expect(page.locator('main h1')).toHaveText(editor.name)
  await expect(page.getByText('1 published article', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: published })).toBeVisible()
  await expect(page.getByText(unpublished)).toHaveCount(0)
  expect(errors).toEqual([])
  await ctx.close()

  // Phone width: the button stays on screen inside the scrollable dialog.
  const phone = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
  const phonePage = await phone.newPage()
  const phoneDialog = await openProfile(phonePage, editor.name)
  const phoneLink = phoneDialog.getByRole('link', { name: 'Read their articles →' })
  await phoneLink.scrollIntoViewIfNeeded()
  await expect(phoneLink).toBeInViewport()
  await phone.close()
})
