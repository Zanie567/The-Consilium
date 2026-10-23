import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getIp } from '@/lib/rate-limit'
import { collectAnalytics } from '@/lib/analyticsCollector'
import { createHash } from 'node:crypto'
export async function POST(req: NextRequest) {
  if (/bot|crawler|spider|headless|preview/i.test(req.headers.get('user-agent') ?? ''))
    return NextResponse.json({ ok: true })
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 4096) return NextResponse.json({ ok: true })
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ ok: true })
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: true })
  }
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim() || body.sessionId.length > 128)
    return NextResponse.json({ ok: true })

  const ip = getIp(req)
  const session = createHash('sha256').update(body.sessionId).digest('hex')
  // Keep the original per-client budget, without making every reader behind a
  // university NAT share 60 events/minute. A coarse IP ceiling still bounds
  // random-session floods: 1,000 active readers send ~2,000 heartbeats/minute.
  // Like the site's other limiters, these budgets are per function instance.
  if (!checkRateLimit(`track-ip:${ip}`, 6000, 60000) ||
      !checkRateLimit(`track-session:${ip}:${session}`, 60, 60000)) {
    return NextResponse.json({ error: 'Tracking rate limited' }, {
      status: 429, headers: { 'Retry-After': '60' },
    })
  }
  try {
    await collectAnalytics(body)
  } catch {
    // Never claim persistence succeeded. The counter retries its cumulative
    // reading time on the next heartbeat; existing transaction deduplication
    // makes ambiguous acknowledgements safe to retry.
    console.error('[analytics:track] persistence failed')
    return NextResponse.json({ error: 'Tracking temporarily unavailable' }, {
      status: 503, headers: { 'Retry-After': '30' },
    })
  }
  return NextResponse.json({ ok: true })
}
