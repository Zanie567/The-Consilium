import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getVerifiedSessionUser, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import slugify from 'slugify'
import { stripHtml } from '@/lib/content-filter'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import type { ArticleStatus } from '@prisma/client'

const STAFF_ARTICLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED', 'SCHEDULED'] as const satisfies readonly ArticleStatus[]
const WRITER_CREATE_STATUSES = ['DRAFT', 'PENDING_REVIEW'] as const satisfies readonly ArticleStatus[]

function computeWordCount(content: string): number {
  try {
    const parsed = JSON.parse(content)
    const extractText = (node: { type?: string; text?: string; content?: unknown[] }): string => {
      if (node.text) return node.text
      if (node.content) return (node.content as typeof node[]).map(extractText).join(' ')
      return ''
    }
    const text = extractText(parsed)
    return text.trim().split(/\s+/).filter(Boolean).length
  } catch {
    return content
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const status   = searchParams.get('status')
  const category = searchParams.get('category')
  const take     = parseInt(searchParams.get('take') ?? '20')
  const mine     = searchParams.get('mine') === 'true'
  const session = await getServerSession(authOptions)

  if (session?.user.role === 'GROWTH') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Drafts-for-current-user query (used by My Drafts section + autosave polling)
  if (mine) {
    const authError = requireActiveSession(session)
    if (authError) return authError

    try {
      const drafts = await prisma.article.findMany({
        where: {
          authorId: session!.user.id,
          status: (status?.toUpperCase() ?? 'DRAFT') as never,
          deletedAt: null,
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id:        true,
          title:     true,
          excerpt:   true,
          content:   true,
          updatedAt: true,
          category:  { select: { id: true, name: true } },
        },
      })

      const result = drafts.map((d) => ({
        id:        d.id,
        title:     d.title,
        excerpt:   d.excerpt,
        updatedAt: d.updatedAt,
        category:  d.category,
        wordCount: computeWordCount(d.content),
      }))

      return Response.json(result)
    } catch {
      return Response.json({ error: 'Failed to fetch drafts' }, { status: 500 })
    }
  }

  // BUG-01: Non-PUBLISHED queries must be restricted to editorial staff.
  // Without this check any visitor could retrieve all drafts by passing ?status=DRAFT.
  const requestedStatus = status?.toUpperCase() ?? 'PUBLISHED'
  if (requestedStatus !== 'PUBLISHED') {
    const authError = requireActiveSession(session)
    if (authError) return authError
    const role = (session!.user as { role?: string }).role
    if (!role || !['ADMIN', 'EDITOR', 'WRITER'].includes(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const articles = await prisma.article.findMany({
      where: {
        status: requestedStatus as never,
        deletedAt: null,
        ...(category ? { category: { slug: category } } : {}),
        ...(session?.user.role === 'WRITER' && requestedStatus !== 'PUBLISHED'
          ? { authorId: session.user.id }
          : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take,
      include: { author: true, category: true },
    })
    return Response.json(articles)
  } catch {
    return Response.json({ error: 'Failed to fetch articles' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await getVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!user) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { title, slug: rawSlug, content, excerpt, coverImage, categoryId, status, tags, authorId: bodyAuthorId } = body

    const isAdminOrEditorCreating = ['ADMIN', 'EDITOR'].includes(user.role)
    const effectiveAuthorId = (isAdminOrEditorCreating && bodyAuthorId)
      ? bodyAuthorId
      : user.id

    const requestedStatus = typeof status === 'string' ? status : 'DRAFT'
    const allowedStatuses = isAdminOrEditorCreating ? STAFF_ARTICLE_STATUSES : WRITER_CREATE_STATUSES
    const finalStatus = (allowedStatuses as readonly string[]).includes(requestedStatus)
      ? requestedStatus as ArticleStatus
      : 'DRAFT'

    // Title is optional for autosave - untitled drafts are valid
    const effectiveTitle = title ?? ''

    // Generate a unique slug from title, or a timestamp-based one if title is empty
    let slug = rawSlug
    if (!slug) {
      const base = effectiveTitle
        ? slugify(effectiveTitle, { lower: true, strict: true, trim: true })
        : `draft-${Date.now()}`
      slug = base || `draft-${Date.now()}`
    }

    // Ensure slug uniqueness
    const existing = await prisma.article.findUnique({ where: { slug } })
    if (existing) {
      slug = `${slug}-${Date.now()}`
    }

    const article = await prisma.article.create({
      data: {
        title:      effectiveTitle,
        slug,
        content:    content ?? '',
        excerpt:    excerpt ?? null,
        coverImage: coverImage ?? null,
        categoryId: categoryId ?? null,
        authorId:   effectiveAuthorId,
        status:     finalStatus,
        publishedAt: finalStatus === 'PUBLISHED' ? new Date() : null,
      },
    })

    // Handle tags if provided
    if (Array.isArray(tags) && tags.length > 0) {
      const tagRecords = await Promise.all(
        tags.map((name: string) => {
          // BUG-14: Strip HTML from tag names before storage to prevent XSS
          const safeName = stripHtml(name).trim()
          const tagSlug = safeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          return prisma.tag.upsert({
            where: { slug: tagSlug },
            update: {},
            create: { name: safeName, slug: tagSlug },
          })
        })
      )
      await prisma.articleTag.createMany({
        data: tagRecords.map((t) => ({ articleId: article.id, tagId: t.id })),
        skipDuplicates: true,
      })
    }

    return Response.json(article, { status: 201 })
  } catch (error) {
    console.error('Create article error:', error)
    return Response.json({ error: 'Failed to create article' }, { status: 500 })
  }
}
