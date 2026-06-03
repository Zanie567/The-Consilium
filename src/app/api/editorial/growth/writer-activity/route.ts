/**
 * GET /api/editorial/growth/writer-activity
 *
 * Internal operational view for the GROWTH role (and ADMIN): every WRITER and
 * EDITOR with their publishing activity and at-risk flag. Ordered by most recent
 * publication, never-published last.
 */

import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { getWriterActivity } from '@/lib/gamification/writerActivity'

export const dynamic = 'force-dynamic'

export async function GET() {
  // ANALYTICS_ACCESS_ROLES is [ADMIN, GROWTH]; any other (or no) session is 403.
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const writers = await getWriterActivity()
    return NextResponse.json({ writers })
  } catch (err) {
    console.error(
      '[growth/writer-activity] Error:',
      err instanceof Error ? err.message : String(err)
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
