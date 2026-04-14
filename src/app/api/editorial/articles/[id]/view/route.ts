import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

export async function POST(req: Request, { params }: Props) {
  const { id } = await params
  const referer = req.headers.get('referer') ?? req.headers.get('referrer') ?? null
  const source = classifySource(referer)

  // Try to record with source; fall back gracefully if the column isn't migrated yet
  try {
    await prisma.$transaction([
      prisma.articleView.create({ data: { articleId: id, source } }),
      prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
    ])
  } catch {
    await prisma.$transaction([
      prisma.articleView.create({ data: { articleId: id } }),
      prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
    ]).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
