/**
 * POST /api/cron/scheduler-health
 *
 * Independent health check for scheduled publishing (see src/lib/schedulerHealth.ts). Called about
 * hourly by .github/workflows/scheduler-health.yml, which fails (and so emails) only when `alert` is
 * true. It reads the application database and, if present, the Supabase scheduler records; it never
 * publishes, deletes, or calls the publisher. It writes one small audit row only when it raises an
 * alert or records a recovery (de-duplication state).
 *
 * Authentication: the shared CRON_SECRET, like every other cron route, via verifyCronAuth. The
 * publish-only secret is deliberately NOT accepted here (only the publish route may take it).
 *
 * The response is printed into a PUBLIC repository's Actions logs: it carries counts and ages only,
 * and a failure is a fixed message (the real error is logged server-side).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyCronAuth } from '@/lib/cronAuth'
import { runHealthCheck } from '@/lib/schedulerHealth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const authError = verifyCronAuth(req, 'scheduler-health')
  if (authError) return authError

  try {
    return NextResponse.json(await runHealthCheck(prisma))
  } catch (error) {
    console.error('[scheduler-health] check failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'scheduler health check failed; see the server logs' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return POST(req)
}
