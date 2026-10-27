import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { getWeeklyGrowthReview } from '@/lib/weeklyGrowthReview'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const report = await getWeeklyGrowthReview()
    return NextResponse.json(report, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Weekly review temporarily unavailable' }, { status: 503 })
  }
}
