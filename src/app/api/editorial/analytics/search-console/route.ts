import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { getSearchConsoleReport } from '@/lib/searchConsoleAnalytics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rawPeriod = request.nextUrl.searchParams.get('period') ?? '30d'
  if (!['24h','7d','30d','90d'].includes(rawPeriod))
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  const data = await getSearchConsoleReport(rawPeriod)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
