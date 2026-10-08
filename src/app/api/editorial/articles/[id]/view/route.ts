import { NextRequest, NextResponse } from 'next/server'
import { POST as track } from '@/app/api/analytics/track/route'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    /* old empty-body clients */
  }
  if (typeof body.sessionId !== 'string')
    return NextResponse.json({ ok: true }, { headers: { Deprecation: 'true' } })
  return track(
    new NextRequest(new URL('/api/analytics/track', req.url), {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ ...body, articleId: id }),
    })
  )
}
