/**
 * POST /api/cron/newsletter: one idempotent pass of the newsletter scheduler (sync retries, webhook
 * reconciliation, weekly edition build, due sends, retention). Meant to run hourly once activated
 * (supabase/manual/newsletter_cron_enable.sql or the manual-only GitHub workflow). Merging does not
 * schedule it, and the pause switch defaults to paused, so nothing is sent until an administrator
 * unpauses AND approves an edition.
 *
 * Auth: Bearer NEWSLETTER_CRON_SECRET or CRON_SECRET (constant time). Response: counts and ids only.
 */
import { NextResponse } from 'next/server'
import { verifyNewsletterCronAuth } from '@/lib/cronAuth'
import { runNewsletterTick } from '@/lib/newsletter/tick'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const authError = verifyNewsletterCronAuth(request, 'newsletter')
  if (authError) return authError
  try {
    const summary = await runNewsletterTick()
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[newsletter] tick failed:', (error as Error).message)
    return NextResponse.json({ error: 'newsletter tick failed' }, { status: 500 })
  }
}
