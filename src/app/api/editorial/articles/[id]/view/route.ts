import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

interface Props {
  params: Promise<{ id: string }>
}

function classifySource(referer: string | null): string {
  if (!referer) return 'Direct'

  try {
    const hostname = new URL(referer).hostname.replace(/^www\./, '')

    const search = ['google.', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'baidu.com', 'yandex.']
    const social = ['twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'threads.net', 'pinterest.com', 'youtube.com']
    const email = ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'proton.me', 'fastmail.com']

    if (search.some((s) => hostname.includes(s))) return 'Search'
    if (social.some((s) => hostname.includes(s))) return 'Social'
    if (email.some((s) => hostname.includes(s))) return 'Email'
    return 'Other'
  } catch {
    return 'Direct'
  }
}

export async function POST(req: NextRequest, { params }: Props) {
  const { id } = await params

  // BUG-02: Rate limit — 1 view per IP per article per 10 minutes to prevent count inflation
  const ip = getIp(req)
  if (!checkRateLimit(`view:${ip}:${id}`, 1, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: true }) // silent — don't reveal the limit to clients
  }

  const referer = req.headers.get('referer') ?? req.headers.get('referrer') ?? null
  const source = classifySource(referer)

  // Try to record with source; fall back if the source column isn't migrated yet
  try {
    await prisma.$transaction([
      prisma.articleView.create({ data: { articleId: id, source } }),
      prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
    ])
    return NextResponse.json({ ok: true })
  } catch {
    // Column may not exist yet — retry without source field
    try {
      await prisma.$transaction([
        prisma.articleView.create({ data: { articleId: id } }),
        prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
      ])
      return NextResponse.json({ ok: true })
    } catch (err) {
      // BUG-02: Surface real DB failures rather than masking them with a false ok
      console.error('[view] DB error:', err)
      return NextResponse.json({ error: 'Failed to record view.' }, { status: 500 })
    }
  }
}
