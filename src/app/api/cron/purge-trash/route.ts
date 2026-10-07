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

export async function POST(req: Request) {
  const authError = verifyCronAuth(req, 'purge-trash')
  if (authError) return authError

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  try {
    const result = await purgeExpiredTrash({ dryRun })

    if (result.count > 0) {
      console.warn(
        `[purge-trash] Permanently deleted ${result.count} article(s) from trash: ${result.articleIds.join(', ')}`,
      )
      revalidateArticleLists()
    }
    for (const failure of result.errors) {
      console.error(`[purge-trash] Failed to purge ${failure.articleId}: ${failure.message}`)
    }

    return NextResponse.json(
      {
        ranAt: result.ranAt,
        dryRun: result.dryRun,
        retentionDays: result.retentionDays,
        cutoff: result.cutoff,
        purged: { count: result.count, articleIds: result.articleIds, articles: result.articles },
        wouldPurge: result.wouldPurge,
        errors: result.errors,
      },
      { status: result.errors.length > 0 ? 500 : 200 },
    )
  } catch (err) {
    // Full detail goes to the server log under a reference; the caller gets the
    // reference only, never a raw database error.
    const reference = randomUUID().slice(0, 8)
    console.error(`[purge-trash] Job failed (ref ${reference}):`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Trash purge failed', job: 'purge-trash', reference }, { status: 500 })
  }
}
