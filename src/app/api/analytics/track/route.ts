import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { collectAnalytics } from '@/lib/analyticsCollector'
export async function POST(req: NextRequest) {
  if (
    !checkRateLimit(`track:${getIp(req)}`, 60, 60000) ||
    /bot|crawler|spider|headless|preview/i.test(req.headers.get('user-agent') ?? '')
  )
    return NextResponse.json({ ok: true })
  try {
    const raw = await req.text()
    if (raw.length <= 4096) await collectAnalytics(JSON.parse(raw))
  } catch {
    /* analytics must not block reading */
  }
  return NextResponse.json({ ok: true })
}
