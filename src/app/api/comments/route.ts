import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { filterComment, stripHtml } from '@/lib/content-filter'
import { checkRateLimit } from '@/lib/rate-limiter'
import { sendEmail, commentFlaggedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// ── GET /api/comments?articleId=xxx ──────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const articleId = searchParams.get('articleId')
  if (!articleId) return NextResponse.json({ error: 'articleId required' }, { status: 400 })

  const session = await getServerSession(authOptions)

  const comments = await prisma.comment.findMany({
    where: { articleId, isHidden: false, parentId: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      user: { select: { id: true, name: true, image: true } },
      replies: {
        where: { isHidden: false },
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, image: true } },
          upvotedBy: session?.user?.id
            ? { where: { userId: session.user.id }, select: { id: true } }
            : false,
          _count: { select: { replies: true } },
        },
      },
      upvotedBy: session?.user?.id
        ? { where: { userId: session.user.id }, select: { id: true } }
        : false,
      _count: { select: { replies: { where: { isHidden: false } } } },
    },
  })

  const total = await prisma.comment.count({
    where: { articleId, isHidden: false },
  })

  return NextResponse.json({ comments, total })
}

// ── POST /api/comments ───────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'You must be signed in to comment.' }, { status: 401 })
  }

  // Rate limit: 5 comments per user per minute
  if (!checkRateLimit(`comment:${session.user.id}`, 5, 60 * 1000)) {
    return NextResponse.json(
      { error: 'You are posting too quickly. Please wait a moment before commenting again.' },
      { status: 429 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { articleId, body: rawBody, parentId } = body as {
    articleId?: string
    body?: string
    parentId?: string
  }

  if (!articleId || typeof articleId !== 'string') {
    return NextResponse.json({ error: 'articleId is required' }, { status: 400 })
  }
  if (!rawBody || typeof rawBody !== 'string') {
    return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
  }

  const cleanBody = stripHtml(rawBody).trim()
  if (cleanBody.length < 3) {
    return NextResponse.json({ error: 'Comment must be at least 3 characters.' }, { status: 400 })
  }
  if (cleanBody.length > 1000) {
    return NextResponse.json({ error: 'Comment must be 1000 characters or fewer.' }, { status: 400 })
  }

  // Content filter
  const filterResult = filterComment(cleanBody)
  if (!filterResult.allowed) {
    return NextResponse.json({ error: filterResult.reason }, { status: 400 })
  }

  // Verify article exists and is published
  const article = await prisma.article.findUnique({
    where: { id: articleId, status: 'PUBLISHED' },
    select: { id: true, title: true },
  })
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  }

  // Verify parent exists if provided
  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true },
    })
    if (!parent) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 })
    }
  }

  // BUG-13: Include upvotedBy and matching _count shape so the newly created
  // comment has the same structure as comments returned by GET, preventing
  // client-side errors when code maps over comment.upvotedBy.
  const comment = await prisma.comment.create({
    data: {
      articleId,
      userId: session.user.id,
      body: cleanBody,
      parentId: parentId ?? null,
      isHidden: false,
      flagReason: filterResult.flagForReview ? (filterResult.flagReason ?? null) : null,
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
      upvotedBy: { where: { userId: session.user.id }, select: { id: true } },
      _count: { select: { replies: { where: { isHidden: false } } } },
    },
  })

  // Email admin if comment was flagged
  if (filterResult.flagForReview) {
    const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { email: true },
    })
    const targets = [...adminEmails, ...admins.map((a) => a.email)].filter(Boolean)
    for (const to of targets) {
      const tpl = commentFlaggedEmail(
        article.title,
        article.id,
        cleanBody,
        filterResult.flagReason ?? 'unknown',
      )
      await sendEmail({ to, ...tpl })
    }
  }

  return NextResponse.json(comment, { status: 201 })
}
