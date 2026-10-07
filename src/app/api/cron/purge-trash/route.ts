/**
 * POST /api/cron/purge-trash[?dryRun=1]
 *
 * Permanently deletes articles that have been in trash longer than the retention
 * period (30 days unless TRASH_RETENTION_DAYS overrides it). Split out of the
 * scheduled-publish job so that publishing can never delete anything.
 *
 * Every response carries `purged: { count, articleIds, articles }`, including when
 * nothing was purged, and every deletion has an audit_logs row. Any per-article failure
 * returns HTTP 500 so the GitHub Actions run goes red instead of looking successful.
 *
 * POST only, on purpose: a GET (prefetch, link preview, crawler) must never delete data.
 * `?dryRun=1` lists what a real run would remove and changes nothing.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET> (same secret as the other cron routes).
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { verifyCronAuth } from '@/lib/cronAuth'
import { purgeExpiredTrash } from '@/lib/trashPurge'
import { revalidateArticleLists } from '@/lib/revalidateArticles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The only accepted query is `dryRun=1|true|0|false`. This endpoint deletes data, so the
 * flag fails SAFE: a typo (`dryrun=1`, `dryRun=yes`, a bare `?dryRun`), a repeated key or
 * an unknown parameter is refused with 400 instead of silently becoming a real purge.
 */
function parseDryRun(url: URL): { dryRun: boolean } | null {
  for (const key of url.searchParams.keys()) if (key !== 'dryRun') return null
  const values = url.searchParams.getAll('dryRun')
  if (values.length === 0) return { dryRun: false }
  if (values.length > 1) return null
  const value = values[0].toLowerCase()
  if (value === '1' || value === 'true') return { dryRun: true }
  if (value === '0' || value === 'false') return { dryRun: false }
  return null
}

// This repository is public, so the workflow's logged response body is world-readable.
// Return ids and timestamps only: titles/slugs live in audit_logs, and raw database errors
// stay in the server log under a reference.
const idOnly = (a: { id: string; deletedAt: string }) => ({ id: a.id, deletedAt: a.deletedAt })

export async function POST(req: Request) {
  const authError = verifyCronAuth(req, 'purge-trash')
  if (authError) return authError

  const parsed = parseDryRun(new URL(req.url))
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid query. The only accepted parameter is dryRun=1|true|0|false.', job: 'purge-trash' },
      { status: 400 },
    )
  }

  try {
    const result = await purgeExpiredTrash({ dryRun: parsed.dryRun })

    if (result.count > 0) {
      console.warn(
        `[purge-trash] Permanently deleted ${result.count} article(s) from trash: ${result.articleIds.join(', ')}`,
      )
      revalidateArticleLists()
    }
    const errors = result.errors.map((failure) => {
      const reference = randomUUID().slice(0, 8)
      console.error(`[purge-trash] Failed to purge ${failure.articleId} (ref ${reference}): ${failure.message}`)
      return { articleId: failure.articleId, reference, message: 'purge failed; see server log' }
    })

    return NextResponse.json(
      {
        ranAt: result.ranAt,
        dryRun: result.dryRun,
        retentionDays: result.retentionDays,
        cutoff: result.cutoff,
        purged: { count: result.count, articleIds: result.articleIds, articles: result.articles.map(idOnly) },
        wouldPurge: result.wouldPurge.map(idOnly),
        errors,
      },
      { status: errors.length > 0 ? 500 : 200 },
    )
  } catch (err) {
    // Full detail goes to the server log under a reference; the caller gets the
    // reference only, never a raw database error.
    const reference = randomUUID().slice(0, 8)
    console.error(`[purge-trash] Job failed (ref ${reference}):`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Trash purge failed', job: 'purge-trash', reference }, { status: 500 })
  }
}
