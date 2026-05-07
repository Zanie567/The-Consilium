/**
 * migrate-em-dashes.ts
 *
 * Finds every em dash (U+2014) in the following fields and replaces it with
 * a spaced hyphen ( - ):
 *
 *   debates   → title, description
 *   articles  → title, excerpt, content (Tiptap JSON - text nodes only)
 *
 * Debate FOR / AGAINST argument bodies are the linked articles' content fields
 * and are therefore covered by the articles pass above.
 *
 * Usage
 * ─────
 *   Dry-run - prints all changes, writes nothing:
 *     npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts
 *
 *   Apply changes to the database:
 *     npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts --apply
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env.local') })

import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ── Prisma setup ──────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! })
const prisma = new PrismaClient({ adapter })

// ── Helpers ───────────────────────────────────────────────────────────────────

const EM_DASH = '\u2014'
const REPLACEMENT = ' - '

/**
 * Replace every em dash in a plain string with a spaced hyphen.
 * Collapses any surrounding whitespace so "how - and" → "how - and"
 * rather than "how  -  and".
 */
function replacePlain(value: string): string {
  return value.replace(/\s*\u2014\s*/g, REPLACEMENT)
}

/** Minimal Tiptap node shape - only fields we touch. */
type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  [key: string]: unknown
}

/** Walk a Tiptap doc tree and replace em dashes in every text node. */
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
 * Replace em dashes inside a serialised Tiptap JSON string.
 * Returns the updated JSON, or null if the value contained no em dashes.
 * Falls back to plain-string replacement if the value is not valid JSON.
 */
function replaceTiptapJson(raw: string): string | null {
  if (!raw.includes(EM_DASH)) return null
  try {
    const doc = JSON.parse(raw) as TiptapNode
    return JSON.stringify(replaceTiptapNode(doc))
  } catch {
    const updated = replacePlain(raw)
    return updated !== raw ? updated : null
  }
}

// ── Change record ─────────────────────────────────────────────────────────────

interface Change {
  table: string
  id: string
  field: string
  /** Human-readable label shown in the dry-run output (e.g. article title). */
  label: string
  before: string
  after: string
}

const changes: Change[] = []

function record(
  table: string,
  id: string,
  field: string,
  label: string,
  before: string,
  after: string,
) {
  changes.push({ table, id, field, label, before, after })
}

// ── Scan ──────────────────────────────────────────────────────────────────────

async function scanDebates() {
  const rows = await prisma.debate.findMany({
    select: { id: true, title: true, description: true },
  })
  for (const d of rows) {
    if (d.title.includes(EM_DASH)) {
      record('debates', d.id, 'title', d.title, d.title, replacePlain(d.title))
    }
    if (d.description?.includes(EM_DASH)) {
      record('debates', d.id, 'description', d.title, d.description, replacePlain(d.description))
    }
  }
}

async function scanArticles() {
  const rows = await prisma.article.findMany({
    select: { id: true, title: true, excerpt: true, content: true },
  })
  for (const a of rows) {
    if (a.title.includes(EM_DASH)) {
      record('articles', a.id, 'title', a.title, a.title, replacePlain(a.title))
    }
    if (a.excerpt?.includes(EM_DASH)) {
      record('articles', a.id, 'excerpt', a.title, a.excerpt, replacePlain(a.excerpt))
    }
    const updatedContent = replaceTiptapJson(a.content)
    if (updatedContent !== null) {
      // Show a short snippet rather than the full JSON blob.
      const snippet =
        a.content.match(/[^"]{0,40}\u2014[^"]{0,40}/g)?.slice(0, 5).join(' … ') ??
        '(see full content)'
      const snippetAfter = snippet.replace(/\s*\u2014\s*/g, ' - ')
      record('articles', a.id, 'content', a.title, snippet, snippetAfter)
    }
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function applyChanges() {
  // Coalesce all field changes for the same row into a single UPDATE.
  type DebateRowUpdate = {
    table: 'debates'
    id: string
    updates: Prisma.DebateUpdateInput
  }
  type ArticleRowUpdate = {
    table: 'articles'
    id: string
    updates: Prisma.ArticleUpdateInput
  }
  type RowUpdate = DebateRowUpdate | ArticleRowUpdate

  const byRow = new Map<string, RowUpdate>()

  const ensureRow = (table: string, id: string): RowUpdate => {
    const key = `${table}:${id}`
    if (!byRow.has(key)) {
      if (table === 'debates') {
        byRow.set(key, { table: 'debates', id, updates: {} })
      } else {
        byRow.set(key, { table: 'articles', id, updates: {} })
      }
    }
    return byRow.get(key)!
  }

  for (const c of changes) {
    const row = ensureRow(c.table, c.id)
    if (c.field === 'title' || c.field === 'description' || c.field === 'excerpt') {
      if (c.field === 'title') {
        row.updates.title = c.after
      } else if (c.field === 'description' && row.table === 'debates') {
        row.updates.description = c.after
      } else if (c.field === 'excerpt' && row.table === 'articles') {
        row.updates.excerpt = c.after
      }
    }
    // content is handled below with the full raw value
  }

  // Re-fetch and re-process article content (the `after` stored in changes is
  // only a snippet preview, not the full updated JSON).
  const contentIds = [...new Set(
    changes.filter((c) => c.table === 'articles' && c.field === 'content').map((c) => c.id),
  )]
  if (contentIds.length > 0) {
    const contentRows = await prisma.article.findMany({
      where: { id: { in: contentIds } },
      select: { id: true, content: true },
    })
    for (const row of contentRows) {
      const updated = replaceTiptapJson(row.content)
      if (updated) {
        const articleRow = ensureRow('articles', row.id)
        if (articleRow.table === 'articles') {
          articleRow.updates.content = updated
        }
      }
    }
  }

  let updatedRows = 0
  for (const { table, id, updates } of byRow.values()) {
    if (Object.keys(updates).length === 0) continue
    if (table === 'debates') {
      await prisma.debate.update({ where: { id }, data: updates })
    } else {
      await prisma.article.update({ where: { id }, data: updates })
    }
    updatedRows++
  }

  console.log(`\n✅  ${updatedRows} row(s) updated.`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Scanning for em dashes (U+2014) …\n')
  await scanDebates()
  await scanArticles()

  if (changes.length === 0) {
    console.log('No em dashes found. Nothing to do.')
    return
  }

  // Print every proposed change, grouped by table.
  const tables = [...new Set(changes.map((c) => c.table))]
  for (const table of tables) {
    const group = changes.filter((c) => c.table === table)
    console.log('─'.repeat(72))
    console.log(`TABLE: ${table.toUpperCase()}  (${group.length} change(s))`)
    console.log('─'.repeat(72))
    for (const c of group) {
      console.log(`  id     : ${c.id}`)
      console.log(`  label  : ${c.label}`)
      console.log(`  field  : ${c.field}`)
      console.log(`  BEFORE : ${c.before}`)
      console.log(`  AFTER  : ${c.after}`)
      console.log()
    }
  }

  const uniqueRows = new Set(changes.map((c) => `${c.table}:${c.id}`)).size
  console.log('─'.repeat(72))
  console.log(`Total: ${changes.length} field change(s) across ${uniqueRows} row(s)`)
  console.log()

  if (!apply) {
    console.log('DRY-RUN - nothing was written to the database.')
    console.log('Re-run with --apply to commit these changes:\n')
    console.log('  npx ts-node -P tsconfig.seed.json prisma/migrate-em-dashes.ts --apply\n')
    return
  }

  console.log('Applying changes …')
  await applyChanges()
}

main()
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
