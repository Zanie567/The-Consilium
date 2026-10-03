import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { signedIn, type SessionName } from './helpers/workflow'
import { collectConsoleErrors } from './helpers/console'

/**
 * Who can see and open what. For each account type the test signs in, reads the
 * editorial navigation, and checks that
 *   - the menu is exactly the documented one (a link appearing or vanishing is a change
 *     someone must approve),
 *   - every link in it opens, with a heading and no console error,
 *   - the editorial pages that are NOT in the menu are refused (redirect, 403 or 404),
 *     not merely hidden.
 * With E2E_INVENTORY_DIR set it also writes every control it finds on every page to
 * JSON, which is how docs/testing/coverage-inventory.md is kept honest.
 */

type NavLink = { label: string; href: string }

const NAV: Record<'writer' | 'editor' | 'admin' | 'growth', NavLink[]> = {
  writer: [
    { label: 'Dashboard', href: '/editorial' },
    { label: 'Team Profile', href: '/editorial/team-profile' },
    { label: 'My Articles', href: '/editorial/articles' },
    { label: 'My Drafts', href: '/editorial/articles?mine=true&status=DRAFT' },
    { label: 'New Article', href: '/editorial/articles/new' },
    { label: 'Your Readers', href: '/editorial/readers' },
    { label: 'Leaderboard', href: '/editorial/leaderboard' },
  ],
  editor: [
    { label: 'Dashboard', href: '/editorial' },
    { label: 'Team Profile', href: '/editorial/team-profile' },
    { label: 'All Articles', href: '/editorial/articles' },
    { label: 'My Drafts', href: '/editorial/articles?mine=true&status=DRAFT' },
    { label: 'New Article', href: '/editorial/articles/new' },
    { label: 'Article Series', href: '/editorial/series' },
    { label: 'Scheduled', href: '/editorial/scheduled' },
    { label: 'Trash', href: '/editorial/trash' },
    { label: 'Review Queue', href: '/editorial/review' },
    { label: 'Debates', href: '/editorial/debates' },
    { label: 'Comments', href: '/editorial/comments' },
    { label: 'Your Readers', href: '/editorial/readers' },
  ],
  admin: [
    { label: 'Dashboard', href: '/editorial' },
    { label: 'All Articles', href: '/editorial/articles' },
    { label: 'My Drafts', href: '/editorial/articles?mine=true&status=DRAFT' },
    { label: 'New Article', href: '/editorial/articles/new' },
    { label: 'Article Series', href: '/editorial/series' },
    { label: 'Scheduled', href: '/editorial/scheduled' },
    { label: 'Calendar', href: '/editorial/calendar' },
    { label: 'Trash', href: '/editorial/trash' },
    { label: 'Review Queue', href: '/editorial/review' },
    { label: 'Debates', href: '/editorial/debates' },
    { label: 'Comments', href: '/editorial/comments' },
    { label: 'Users', href: '/editorial/users' },
    { label: 'Analytics', href: '/editorial/analytics' },
    { label: 'Predictions', href: '/editorial/predictions' },
    { label: 'Glossary', href: '/editorial/glossary' },
    { label: 'Your Readers', href: '/editorial/readers' },
  ],
  growth: [
    { label: 'Dashboard', href: '/editorial' },
    { label: 'Analytics', href: '/editorial/analytics' },
    { label: 'Subscribers', href: '/editorial/growth/subscribers' },
    { label: 'Engagement', href: '/editorial/growth/engagement' },
    { label: 'Team Profile', href: '/editorial/team-profile' },
  ],
}

/** Every top-level editorial page, for the "not in my menu means refused" check. */
const ALL_PAGES = [
  '/editorial/articles', '/editorial/articles/new', '/editorial/series', '/editorial/scheduled',
  '/editorial/calendar', '/editorial/trash', '/editorial/review', '/editorial/debates',
  '/editorial/debates/new', '/editorial/comments', '/editorial/users', '/editorial/analytics',
  '/editorial/predictions', '/editorial/predictions/new', '/editorial/glossary', '/editorial/readers',
  '/editorial/leaderboard', '/editorial/growth/subscribers', '/editorial/growth/engagement',
  '/editorial/growth/writer-activity', '/editorial/team-profile',
]

/** Pages a role may open even though they are not menu entries (reached from other pages). */
const EXTRA_ALLOWED: Record<string, string[]> = {
  // Trash: a writer has no menu entry but can open it; it lists only their own deleted articles.
  // Leaderboard: open to every portal role by design (page check: EDITORIAL_PORTAL_ROLES), menu entry for writers only.
  writer: ['/editorial/trash'],
  editor: ['/editorial/debates/new', '/editorial/leaderboard'],
  // Admin: team-profile shows an explanation, not a form (covered by team-profile.spec.ts).
  admin: ['/editorial/debates/new', '/editorial/predictions/new', '/editorial/growth/subscribers', '/editorial/growth/engagement', '/editorial/growth/writer-activity', '/editorial/leaderboard', '/editorial/team-profile'],
  growth: ['/editorial/growth/writer-activity', '/editorial/leaderboard'],
}

const norm = (href: string) => href.split('?')[0]

async function outcome(page: Page, url: string) {
  // networkidle, not domcontentloaded: a server redirect() inside a streamed page arrives
  // as a 200 shell followed by a client navigation, so the URL is only final once idle.
  const res = await page.goto(url, { waitUntil: 'networkidle' })
  const finalPath = new URL(page.url()).pathname
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000)
  const refused =
    (res?.status() ?? 200) >= 400 ||
    finalPath !== norm(url) ||
    /Access Denied|This page could not be found|404/i.test(body)
  return { status: res?.status() ?? 0, finalPath, refused }
}

async function dumpControls(page: Page, role: string, url: string) {
  const dir = process.env.E2E_INVENTORY_DIR
  if (!dir) return
  const browserDir = path.join(dir, page.context().browser()?.browserType().name() ?? 'unknown')
  fs.mkdirSync(browserDir, { recursive: true })
  const controls = await page.evaluate(() => {
    const label = (el: Element) =>
      (el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    const visible = (el: Element) => !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === 'fixed'
    return [...document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="switch"]')]
      .filter(visible)
      .map((el) => ({ tag: el.tagName.toLowerCase(), type: (el as HTMLInputElement).type || '', label: label(el), href: el.getAttribute('href') || '', disabled: (el as HTMLButtonElement).disabled ?? false, role: el.getAttribute('role'), expanded: el.getAttribute('aria-expanded') }))
  })
  const file = path.join(browserDir, `${role}.json`)
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  existing[url] = controls
  fs.writeFileSync(file, JSON.stringify(existing, null, 1))
}

for (const role of ['writer', 'editor', 'admin', 'growth'] as const) {
  test.describe(`${role}`, () => {
    test('the menu is exactly the documented one', async ({ browser }) => {
      const ctx = await signedIn(browser, role as SessionName)
      const page = await ctx.newPage()
      await page.goto('/editorial', { waitUntil: 'networkidle' })
      const links = await page.locator('nav[aria-label="Editorial navigation"] a').evaluateAll((as) =>
        as.map((a) => ({ label: (a.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\d+$/, '').trim(), href: a.getAttribute('href') ?? '' })))
      expect(links).toEqual(NAV[role])
      await ctx.close()
    })

    test('every menu entry opens, with a heading and no console errors', async ({ browser }) => {
      // Admin has many pages. Bound each navigation while giving the complete
      // census enough aggregate time on a machine running other audits.
      test.setTimeout(90_000)
      const ctx = await signedIn(browser, role as SessionName)
      const page = await ctx.newPage()
      const errors = collectConsoleErrors(page)
      for (const link of NAV[role]) {
        const res = await page.goto(link.href, { waitUntil: 'networkidle', timeout: 10_000 })
        expect(res?.status(), `${role} ${link.href}`).toBe(200)
        expect(new URL(page.url()).pathname, `${role} was bounced from ${link.href}`).toBe(norm(link.href))
        if (link.href !== '/editorial/articles/new') {
          await expect(page.locator('h1').first(), `${link.href} has a heading`).toBeVisible()
        }
        await dumpControls(page, role, link.href)
      }
      expect(errors, `console errors for ${role}:\n${errors.join('\n')}`).toEqual([])
      await ctx.close()
    })

    test('editorial pages outside the role are refused, not just hidden', async ({ browser }) => {
      const allowed = new Set([...NAV[role].map((l) => norm(l.href)), ...EXTRA_ALLOWED[role]])
      const ctx = await signedIn(browser, role as SessionName)
      const page = await ctx.newPage()
      const leaks: string[] = []
      for (const url of ALL_PAGES.filter((u) => !allowed.has(u))) {
        const o = await outcome(page, url)
        if (!o.refused) leaks.push(`${url} -> ${o.status} ${o.finalPath}`)
      }
      expect(leaks, `${role} can open pages that are not in their menu:\n${leaks.join('\n')}`).toEqual([])
      await ctx.close()
    })
  })
}

test.describe('reader and signed-out visitors', () => {
  test('a reader cannot enter the editorial portal on any page', async ({ browser }) => {
    const ctx = await signedIn(browser, 'reader')
    const page = await ctx.newPage()
    const leaks: string[] = []
    for (const url of ['/editorial', ...ALL_PAGES]) {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
      const text = await page.locator('body').innerText()
      if (!/Access Denied/i.test(text) && (res?.status() ?? 0) < 400 && new URL(page.url()).pathname === norm(url)) leaks.push(url)
    }
    expect(leaks, `reader reached: ${leaks.join(', ')}`).toEqual([])
    await ctx.close()
  })

  test('the reader account page works for a reader', async ({ browser }) => {
    const ctx = await signedIn(browser, 'reader')
    const page = await ctx.newPage()
    const errors = collectConsoleErrors(page)
    await page.goto('/profile', { waitUntil: 'networkidle' })
    expect(new URL(page.url()).pathname).toBe('/profile')
    await expect(page.locator('h1, h2').first()).toBeVisible()
    await dumpControls(page, 'reader', '/profile')
    expect(errors, errors.join('\n')).toEqual([])
    await ctx.close()
  })

  test('signed-out visitors are sent to sign in from every portal page', async ({ browser }) => {
    const ctx = await signedIn(browser, null)
    const page = await ctx.newPage()
    for (const url of ['/editorial', '/editorial/articles/new', '/editorial/review', '/editorial/users', '/profile']) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      expect(new URL(page.url()).pathname, `${url} must not render for a signed-out visitor`).toMatch(/\/(editorial\/)?login$/)
    }
    await ctx.close()
  })
})

test.describe('sensitive endpoints refuse the wrong roles', () => {
  // [method, path, roles that must be refused]
  const CASES: [string, string, SessionName[], number][] = [
    ['GET', '/api/editorial/growth/subscribers', ['writer', 'editor', 'reader'], 401],
    ['GET', '/api/editorial/users', ['writer', 'growth', 'reader'], 403],
    // Growth may READ the moderation feed on purpose (COMMENT_MODERATION_ROLES), though the page redirects it.
    ['GET', '/api/editorial/comments', ['writer', 'reader'], 401],
    ['GET', '/api/editorial/trash', ['growth', 'reader'], 403],
    ['PATCH', '/api/editorial/articles/none/review', ['writer', 'growth', 'reader'], 403],
    ['POST', '/api/editorial/users', ['writer', 'editor', 'growth', 'reader'], 403],
  ]
  for (const [method, url, roles, expectedStatus] of CASES) {
    for (const who of roles) {
      test(`${who} ${method} ${url} is refused`, async ({ browser }) => {
        const ctx = await signedIn(browser, who)
        const res = await ctx.request.fetch(url, { method, data: method === 'GET' ? undefined : {} })
        expect(res.status(), `${who} got ${res.status()}: ${(await res.text()).slice(0, 120)}`).toBe(expectedStatus)
        await ctx.close()
      })
    }
  }
})
