/**
 * Shared helpers for the browser workflow specs. Everything here drives the UI the way
 * a person does (click, type, upload); the database and storage helpers only READ state
 * back for assertions, or remove the fixtures a spec created.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page, type Response } from '@playwright/test'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTestDatabaseHost } from '../../../scripts/lib/assertSafeTestDatabaseHost'
import {
  ADMIN_STORAGE,
  EDITOR_GLOBAL_STORAGE,
  GROWTH_STORAGE,
  READER_STORAGE,
  WRITER_STORAGE,
} from './authStorage'

export const SESSIONS = {
  writer: WRITER_STORAGE,
  editor: EDITOR_GLOBAL_STORAGE,
  admin: ADMIN_STORAGE,
  growth: GROWTH_STORAGE,
  reader: READER_STORAGE,
} as const
export type SessionName = keyof typeof SESSIONS

/** A fresh browser context signed in as `who`: one per person, so sessions never mix. */
export async function signedIn(browser: Browser, who: SessionName | null): Promise<BrowserContext> {
  return browser.newContext(who ? { storageState: SESSIONS[who] } : {})
}

export function uniqueTitle(label: string) {
  return `WF ${label} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ── Database (test DB only; read-back + fixture cleanup) ────────────────────────────
let prisma: PrismaClient | null = null
export function db(): PrismaClient {
  if (!prisma) {
    const url = process.env.DATABASE_URL ?? ''
    assertSafeTestDatabaseHost(url, 'DATABASE_URL')
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  }
  return prisma
}
export async function closeDb() {
  await prisma?.$disconnect().catch(() => {})
  prisma = null
}

export function articleByTitle(title: string) {
  return db().article.findFirst({ where: { title }, include: { author: true, tags: { include: { tag: true } } } })
}

/** Removes every article a spec created, whatever state it ended in. */
export async function removeArticlesTitled(prefix: string) {
  const rows = await db().article.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } })
  const ids = rows.map((r) => r.id)
  if (!ids.length) return
  await db().notification.deleteMany({ where: { articleId: { in: ids } } })
  await db().articleComment.deleteMany({ where: { articleId: { in: ids } } }).catch(() => {})
  await db().articleTag.deleteMany({ where: { articleId: { in: ids } } })
  await db().article.deleteMany({ where: { id: { in: ids } } })
}

// ── Captured email ────────────────────────────────────────────────────────────────────
export interface CapturedEmail { to: string; subject: string; html: string; at: string }
export function capturedEmails(): CapturedEmail[] {
  const file = process.env.EMAIL_CAPTURE_FILE
  if (!file || !fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CapturedEmail)
}

// ── Storage (the local fake) ──────────────────────────────────────────────────────────
export async function storedObjects(): Promise<{ key: string; type: string; size: number }[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/__objects`)
  return res.json()
}

// ── The article editor page ───────────────────────────────────────────────────────────
export class ArticleEditorPage {
  constructor(readonly page: Page) {}

  title = () => this.page.getByPlaceholder('Your headline here...')
  excerpt = () => this.page.getByPlaceholder('Write a brief summary that draws readers in...')
  body = () => this.page.locator('.tiptap-editor .ProseMirror')
  tool = (title: string | RegExp) => this.page.getByTitle(title)
  saveDraftButton = () => this.page.getByRole('button', { name: 'Save draft' })

  /** A person's first act on a fresh browser: answer the cookie banner, which sits over the editor's lower edge. */
  async dismissCookieBanner() {
    const decline = this.page.getByRole('dialog', { name: 'Cookie consent' }).getByRole('button', { name: 'Decline' })
    if (await decline.isVisible().catch(() => false)) await decline.click()
  }

  async openNew() {
    await this.page.goto('/editorial/articles/new', { waitUntil: 'networkidle' })
    await this.dismissCookieBanner()
    await expect(this.title()).toBeVisible()
    await expect(this.body()).toBeVisible()
    await expect(this.tool('Bold (Ctrl+B)')).toBeVisible()
  }

  async openExisting(id: string) {
    await this.page.goto(`/editorial/articles/${id}/edit`, { waitUntil: 'networkidle' })
    await this.dismissCookieBanner()
    await expect(this.title()).toBeVisible()
    await expect(this.body()).toBeVisible()
  }

  /** Runs `action` and returns the next article save response (POST or PUT/PATCH). */
  async saving(action: () => Promise<void>, opts: { method?: string[]; timeout?: number } = {}): Promise<Response> {
    const methods = opts.method ?? ['POST', 'PUT', 'PATCH']
    const wait = this.page.waitForResponse(
      (r) => /\/api\/articles(\/[^/?]+)?(\?|$)/.test(r.url()) && methods.includes(r.request().method()),
      { timeout: opts.timeout ?? 20_000 },
    )
    await action()
    return wait
  }

  /** Clicks "Save draft" and requires a successful response. */
  async saveNow(): Promise<{ id: string; status: number }> {
    const res = await this.saving(() => this.saveDraftButton().click())
    expect(res.ok(), `save returned ${res.status()}: ${await res.text().catch(() => '')}`).toBe(true)
    const json = (await res.json()) as { id: string }
    return { id: json.id, status: res.status() }
  }

  /** Select all body text, put the caret at the end of it, then type on a new line. */
  async typeBody(text: string) {
    await this.body().click()
    await this.page.keyboard.type(text)
  }

  /** Selects the first occurrence of `text` inside the body using real mouse/keyboard events. */
  async select(text: string) {
    await this.page.evaluate((needle) => {
      const root = document.querySelector('.tiptap-editor .ProseMirror') as HTMLElement
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const at = (node.nodeValue ?? '').indexOf(needle)
        if (at >= 0) {
          root.focus()
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          const sel = window.getSelection()!
          sel.removeAllRanges()
          sel.addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
          return
        }
      }
      throw new Error(`text not found in editor: ${needle}`)
    }, text)
  }

  /**
   * Puts a collapsed caret at the very end of the document. Done through the DOM
   * selection because keyboard "go to end" differs per OS (Ctrl+End vs Cmd+Down), and
   * these specs run on macOS and Linux.
   */
  async moveToEnd() {
    await this.page.evaluate(() => {
      const root = document.querySelector('.tiptap-editor .ProseMirror') as HTMLElement
      root.focus()
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
  }

  /** The saved JSON document as the server stored it. */
  static async savedDoc(title: string): Promise<{ type: string; content: unknown[] }> {
    const row = await articleByTitle(title)
    if (!row) throw new Error(`no article titled ${title}`)
    return JSON.parse(row.content)
  }
}

/** Every node/mark type present in a TipTap document, for coverage assertions. */
export function docTypes(doc: unknown): { nodes: Set<string>; marks: Set<string> } {
  const nodes = new Set<string>()
  const marks = new Set<string>()
  const walk = (n: { type?: string; marks?: { type: string }[]; content?: unknown[] }) => {
    if (n.type) nodes.add(n.type)
    n.marks?.forEach((m) => marks.add(m.type))
    ;(n.content as typeof n[] | undefined)?.forEach(walk)
  }
  walk(doc as never)
  return { nodes, marks }
}

export const visible = (l: Locator) => expect(l).toBeVisible()
