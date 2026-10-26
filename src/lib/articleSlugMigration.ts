/**
 * The approved migration of published article addresses (run by an administrator with
 * scripts/migrate-article-slugs.ts; runbook docs/seo/article-url-migration.md).
 *
 * A published address is permanent (src/lib/articleSlug.ts, trigger articles_slug_guard). This is the one
 * door that changes it, and it always leaves a permanent 301 behind:
 *
 *   1. checkSlugMigration (dry run, read-only): every entry is verified against the live database — the
 *      article exists and is not trashed, still has exactly the old address, the new address is valid and
 *      unused (by any article, trashed or not, and by any retired address), nothing in the plan collides
 *      with anything else, and no correction is pending (its saved base version includes the address).
 *      It returns an approval code: a fingerprint of the plan AND of the current state of every article in it.
 *   2. applySlugMigration: refuses unless given that exact code by an active administrator. In ONE
 *      transaction it repeats every check (so anything that changed since the dry run aborts the whole
 *      migration), declares the authorised migration to the trigger, changes only `slug` on each article
 *      (id, content, author, dates, corrections, comments, views and every relation are untouched; the row's
 *      updatedAt is kept so no "modified" date changes), records old -> new in article_slug_redirects and an
 *      'article.slug_migrated' audit entry per article. All or nothing.
 *
 * Relative imports only: this file is loaded by ts-node, which does not resolve the `@/` alias.
 */
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { isProvisionalSlug, validateCustomSlug } from './articleSlug'

export interface SlugMigrationEntry {
  articleId: string
  from: string
  to: string
  /** For people reading the plan; checked against the database and reported if it differs. */
  title?: string
}

export interface SlugMigrationPlan {
  /** Stable identifier, recorded on every redirect row and audit entry (e.g. "2026-10-24-launch-articles"). */
  id: string
  entries: SlugMigrationEntry[]
}

export interface EntryCheck {
  entry: SlugMigrationEntry
  article: { id: string; slug: string; title: string; status: string; publishedAt: string | null; updatedAt: string } | null
  problems: string[]
  notes: string[]
}

export interface SlugMigrationCheck {
  ok: boolean
  planId: string
  problems: string[]
  entries: EntryCheck[]
  /** Present only when ok. Changes if the plan or any article in it changes. */
  approvalCode: string | null
}

type Db = PrismaClient | Prisma.TransactionClient

const PLAN_ID = /^[a-z0-9][a-z0-9-]{2,79}$/

export function parseSlugMigrationPlan(value: unknown): SlugMigrationPlan {
  const plan = value as Partial<SlugMigrationPlan> | null
  if (!plan || typeof plan !== 'object') throw new Error('The plan must be a JSON object.')
  if (typeof plan.id !== 'string' || !PLAN_ID.test(plan.id)) throw new Error('The plan needs an "id" of lowercase letters, digits and hyphens.')
  if (!Array.isArray(plan.entries) || plan.entries.length === 0) throw new Error('The plan needs at least one entry.')
  if (plan.entries.length > 100) throw new Error('At most 100 entries per migration.')
  const entries = plan.entries.map((e, i) => {
    const entry = e as Partial<SlugMigrationEntry>
    if (!entry || typeof entry.articleId !== 'string' || typeof entry.from !== 'string' || typeof entry.to !== 'string') {
      throw new Error(`Entry ${i + 1} needs string "articleId", "from" and "to".`)
    }
    return { articleId: entry.articleId, from: entry.from, to: entry.to, ...(typeof entry.title === 'string' ? { title: entry.title } : {}) }
  })
  return { id: plan.id, entries }
}

function approvalCodeFor(plan: SlugMigrationPlan, entries: EntryCheck[]): string {
  const state = entries.map((c) => [c.entry.articleId, c.entry.from, c.entry.to, c.article?.slug, c.article?.status, c.article?.updatedAt])
  return createHash('sha256').update(JSON.stringify([plan.id, state])).digest('hex').slice(0, 12)
}

/** Dry run: read-only. */
export async function checkSlugMigration(db: Db, plan: SlugMigrationPlan): Promise<SlugMigrationCheck> {
  const problems: string[] = []
  const seen = { ids: new Set<string>(), from: new Set<string>(), to: new Set<string>() }
  for (const e of plan.entries) {
    if (seen.ids.has(e.articleId)) problems.push(`Article ${e.articleId} appears more than once.`)
    if (seen.from.has(e.from)) problems.push(`Old address ${e.from} appears more than once.`)
    if (seen.to.has(e.to)) problems.push(`New address ${e.to} appears more than once.`)
    seen.ids.add(e.articleId); seen.from.add(e.from); seen.to.add(e.to)
  }
  for (const e of plan.entries) {
    if (seen.from.has(e.to)) problems.push(`New address ${e.to} is also an old address in this plan (no chains or swaps).`)
  }

  const entries: EntryCheck[] = []
  for (const entry of plan.entries) {
    const entryProblems: string[] = []
    const notes: string[] = []
    const row = await db.article.findUnique({
      where: { id: entry.articleId },
      select: {
        id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, deletedAt: true,
        _count: { select: { corrections: { where: { status: 'PENDING' } } } },
      },
    })
    if (!row) entryProblems.push('No article has this id.')
    else {
      if (row.deletedAt) entryProblems.push('The article is in the trash.')
      if (row.slug !== entry.from) entryProblems.push(`Its current address is "${row.slug}", not "${entry.from}".`)
      if (row.status !== 'PUBLISHED') notes.push(`Status is ${row.status}: it is not public now, but its old address still gets a redirect.`)
      if (row._count.corrections > 0) {
        entryProblems.push('A correction is awaiting approval. Publish or withdraw it first (it was prepared against the current address).')
      }
      if (entry.title !== undefined && entry.title !== row.title) notes.push(`Title in the plan differs from the article: "${row.title}".`)
    }

    const target = validateCustomSlug(entry.to)
    if (!target.ok) entryProblems.push(`New address: ${target.error}`)
    else if (target.slug !== entry.to) entryProblems.push(`New address must be written exactly as "${target.slug}".`)
    if (entry.to === entry.from) entryProblems.push('The new address is the same as the old one.')
    if (isProvisionalSlug(entry.to)) entryProblems.push('The new address cannot be a draft placeholder.')

    const [takenBy, toRetired, fromRetired] = await Promise.all([
      db.article.findUnique({ where: { slug: entry.to }, select: { id: true, deletedAt: true } }),
      db.articleSlugRedirect.findUnique({ where: { oldSlug: entry.to }, select: { articleId: true } }),
      db.articleSlugRedirect.findUnique({ where: { oldSlug: entry.from }, select: { articleId: true } }),
    ])
    if (takenBy && takenBy.id !== entry.articleId) {
      entryProblems.push(`New address is already used by ${takenBy.deletedAt ? 'a trashed' : 'another'} article (${takenBy.id}).`)
    }
    if (toRetired) entryProblems.push(`New address is a retired address that redirects to article ${toRetired.articleId}.`)
    if (fromRetired) entryProblems.push(`Old address already has a redirect (to article ${fromRetired.articleId}).`)

    entries.push({
      entry,
      article: row ? {
        id: row.id, slug: row.slug, title: row.title, status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
      } : null,
      problems: entryProblems,
      notes,
    })
  }

  const ok = problems.length === 0 && entries.every((e) => e.problems.length === 0)
  return { ok, planId: plan.id, problems, entries, approvalCode: ok ? approvalCodeFor(plan, entries) : null }
}

export interface SlugMigrationResult {
  migrationId: string
  changed: { articleId: string; from: string; to: string }[]
}

/** Applies an approved plan, all or nothing. Throws (and changes nothing) on any mismatch. */
export async function applySlugMigration(
  prisma: PrismaClient,
  plan: SlugMigrationPlan,
  opts: { approvalCode: string; adminEmail: string },
): Promise<SlugMigrationResult> {
  const admin = await prisma.user.findUnique({
    where: { email: opts.adminEmail },
    select: { id: true, role: true, isActive: true, isBanned: true },
  })
  if (!admin || admin.role !== 'ADMIN' || !admin.isActive || admin.isBanned) {
    throw new Error('Only an active administrator can apply an article address migration.')
  }

  return prisma.$transaction(async (tx) => {
    // Repeat the dry run inside the transaction: the code must match the state being changed.
    const check = await checkSlugMigration(tx, plan)
    if (!check.ok) throw new Error(`The plan no longer passes its checks; nothing was changed.\n${JSON.stringify(check, null, 2)}`)
    if (check.approvalCode !== opts.approvalCode) {
      throw new Error(`Approval code mismatch (expected ${check.approvalCode}): the plan or an article changed since the dry run. Nothing was changed.`)
    }

    // The trigger articles_slug_guard allows a locked address to change only inside a transaction that says so.
    await tx.$executeRaw`SELECT set_config('consilium.article_slug_migration', 'on', true)`

    const changed: SlugMigrationResult['changed'] = []
    for (const { articleId, from, to } of plan.entries) {
      // Raw SQL so Prisma's @updatedAt does not move the article's modification date: only the address changes.
      const count = await tx.$executeRaw`
        UPDATE articles SET slug = ${to}
         WHERE id = ${articleId} AND slug = ${from} AND "deletedAt" IS NULL`
      if (count !== 1) throw new Error(`Article ${articleId} changed during the migration; nothing was changed.`)
      await tx.articleSlugRedirect.create({
        data: { oldSlug: from, articleId, migrationId: plan.id, createdById: admin.id },
      })
      await tx.auditLog.create({
        data: {
          action: 'article.slug_migrated', targetType: 'article', targetId: articleId, performedBy: admin.id,
          metadata: { migrationId: plan.id, before: from, after: to, approvalCode: opts.approvalCode },
        },
      })
      changed.push({ articleId, from, to })
    }
    return { migrationId: plan.id, changed }
  }, { timeout: 30_000 })
}
