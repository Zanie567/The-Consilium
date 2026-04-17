/**
 * migrate-em-dashes.ts
 *
 * Finds every em dash (—, U+2014) in the following fields and replaces it with
 * a spaced hyphen ( - ):
 *
 *   debates        → title, description
 *   articles       → title, excerpt, content (Tiptap JSON — text nodes only)
 *   (Debate FOR / AGAINST argument bodies are the linked articles' content fields
 *    and are therefore covered by the articles pass above.)
 *
 * Usage
 * ─────
 *   Dry-run (prints all changes, writes nothing):
 *     npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts
 *
 *   Apply changes:
 *     npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts --apply
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ── Prisma setup ──────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// ── Helpers ───────────────────────────────────────────────────────────────────

const EM_DASH = '\u2014'
const REPLACEMENT = ' - '

/** Replace all em dashes in a plain string. */
function replacePlain(value: string): string {
  // Normalise any surrounding whitespace so we don't end up with double-spaces.
  // e.g. "foo — bar" → "foo - bar"  (not "foo  -  bar")
  return value.replace(/\s*\u2014\s*/g, REPLACEMENT)
}

/** Tiptap node type (minimal; only what we need). */
type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  marks?: unknown[]
  attrs?: unknown
  [key: string]: unknown
}

/** Recursively replace em dashes in all text nodes in a Tiptap document. */
function replaceTiptapNode(node: TiptapNode): TiptapNode {
  if (node.type === 'text' && typeof node.text === 'string') {
    return { ...node, text: replacePlain(node.text) }
  }
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.map(replaceTiptapNode) }
  }
  return node
}

/**
 * Replace em dashes in a Tiptap JSON string.
 * Returns the updated JSON string, or null if the value had no em dashes.
 */
function replaceTiptapJson(raw: string): string | null {
  if (!raw.includes(EM_DASH)) return null
  try {
    const doc = JSON.parse(raw) as TiptapNode
    const updated = replaceTiptapNode(doc)
    return JSON.stringify(updated)
  } catch {
    // Not valid JSON — treat as plain text (fallback)
    const updated = replacePlain(raw)
    return updated !== raw ? updated : null
  }
}

// ── Change log ────────────────────────────────────────────────────────────────

interface Change {
  table: string
  id: string
  field: string
  label: string           // human-readable identifier (e.g. article title)
  before: string
  after: string
}

const changes: Change[] = []

function recordChange(
  table: string,
  id: string,
  field: string,
  label: string,
  before: string,
  after: string,
) {
  changes.push({ table, id, field, label, before, after })
}

// ── Scan phase ────────────────────────────────────────────────────────────────

async function scanDebates() {
  const debates = await prisma.debate.findMany({
    select: { id: true, title: true, description: true },
  })

  for (const d of debates) {
    if (d.title.includes(EM_DASH)) {
      const after = replacePlain(d.title)
      recordChange('debates', d.id, 'title', d.title, d.title, after)
    }
    if (d.description?.includes(EM_DASH)) {
      const after = replacePlain(d.description)
      recordChange('debates', d.id, 'description', d.title, d.description, after)
    }
  }
}

async function scanArticles() {
  // We fetch all articles.  For large datasets a cursor-based approach would be
  // better, but for a one-time migration this is fine.
  const articles = await prisma.article.findMany({
    select: { id: true, title: true, excerpt: true, content: true },
  })

  for (const a of articles) {
    if (a.title.includes(EM_DASH)) {
      const after = replacePlain(a.title)
      recordChange('articles', a.id, 'title', a.title, a.title, after)
    }
    if (a.excerpt?.includes(EM_DASH)) {
      const after = replacePlain(a.excerpt)
      recordChange('articles', a.id, 'excerpt', a.title, a.excerpt, after)
    }
    const updatedContent = replaceTiptapJson(a.content)
    if (updatedContent !== null) {
      // For the body we just show a summary of affected text rather than the
      // full JSON blob which would be unreadable.
      const bodyPreview = a.content
        .match(/[^"]{0,40}\u2014[^"]{0,40}/g)
        ?.slice(0, 5)
        .join(' … ') ?? '(see full content)'
      const bodyAfterPreview = bodyPreview.replace(/\s*\u2014\s*/g, REPLACEMENT)
      recordChange('articles', a.id, 'content', a.title, bodyPreview, bodyAfterPreview)
    }
  }
}

// ── Apply phase ───────────────────────────────────────────────────────────────

async function applyChanges() {
  // Group changes by (table, id) so we issue at most one UPDATE per row.
  const byRow = new Map<string, { table: string; id: string; updates: Record<string, string> }>()

  for (const c of changes) {
    const key = `${c.table}:${c.id}`
    if (!byRow.has(key)) byRow.set(key, { table: c.table, id: c.id, updates: {} })

    // Re-compute the full replacement (not just the preview stored in `after`).
    if (c.table === 'debates') {
      if (c.field === 'title') {
        byRow.get(key)!.updates.title = c.after
      } else if (c.field === 'description') {
        byRow.get(key)!.updates.description = c.after
      }
    } else if (c.table === 'articles') {
      if (c.field === 'title') {
        byRow.get(key)!.updates.title = c.after
      } else if (c.field === 'excerpt') {
        byRow.get(key)!.updates.excerpt = c.after
      }
      // Content is handled separately (needs the full raw value)
    }
  }

  // Articles with content changes need the full raw value.
  const contentChangeIds = changes
    .filter((c) => c.table === 'articles' && c.field === 'content')
    .map((c) => c.id)

  let contentRows: { id: string; content: string }[] = []
  if (contentChangeIds.length > 0) {
    contentRows = await prisma.article.findMany({
      where: { id: { in: contentChangeIds } },
      select: { id: true, content: true },
    })
    for (const row of contentRows) {
      const key = `articles:${row.id}`
      if (!byRow.has(key)) byRow.set(key, { table: 'articles', id: row.id, updates: {} })
      const updated = replaceTiptapJson(row.content)
      if (updated) byRow.get(key)!.updates.content = updated
    }
  }

  let updated = 0
  for (const { table, id, updates } of byRow.values()) {
    if (Object.keys(updates).length === 0) continue
    if (table === 'debates') {
      await prisma.debate.update({ where: { id }, data: updates })
    } else if (table === 'articles') {
      await (prisma.article.update as Function)({ where: { id }, data: updates })
    }
    updated++
  }

  console.log(`\n✅  Updated ${updated} row(s).`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Scanning for em dashes (—) …\n')

  await scanDebates()
  await scanArticles()

  if (changes.length === 0) {
    console.log('No em dashes found. Nothing to do.')
    return
  }

  // ── Print all changes ────────────────────────────────────────────────────

  // Group by table for a cleaner printout
  const tables = [...new Set(changes.map((c) => c.table))]
  for (const table of tables) {
    const tableChanges = changes.filter((c) => c.table === table)
    console.log(`${'─'.repeat(72)}`)
    console.log(`TABLE: ${table.toUpperCase()}  (${tableChanges.length} change(s))`)
    console.log(`${'─'.repeat(72)}`)

    for (const c of tableChanges) {
      console.log(`  id     : ${c.id}`)
      console.log(`  label  : ${c.label}`)
      console.log(`  field  : ${c.field}`)
      console.log(`  BEFORE : ${c.before}`)
      console.log(`  AFTER  : ${c.after}`)
      console.log()
    }
  }

  console.log(`${'─'.repeat(72)}`)
  console.log(`Total changes: ${changes.length} field(s) across ${[...new Set(changes.map((c) => `${c.table}:${c.id}`))].length} row(s)`)
  console.log()

  if (!apply) {
    console.log('DRY-RUN — no changes were written to the database.')
    console.log('Re-run with --apply to commit these changes:')
    console.log()
    console.log('  npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts --apply')
    console.log()
    return
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  console.log('Applying changes …')
  await applyChanges()
}

main()
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
