import { NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cronAuth'
import { pruneReadingAnalytics } from '@/lib/analyticsEngagement'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const error = verifyCronAuth(req, 'cleanup-reading-analytics')
  if (error) return error
  try {
    return NextResponse.json({ removed: await pruneReadingAnalytics() })
  } catch {
    return NextResponse.json({ error: 'Analytics cleanup unavailable' }, { status: 503 })
  }
}
export const POST = GET
