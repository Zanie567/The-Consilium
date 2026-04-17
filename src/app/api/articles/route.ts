import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import slugify from 'slugify'

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

  // Drafts-for-current-user query (used by My Drafts section + autosave polling)
  if (mine) {
    const session = await getServerSession(authOptions)
    const authError = requireActiveSession(session)
    if (authError) return authError

    try {
      const drafts = await prisma.article.findMany({
        where: {
          authorId: session!.user.id,
          status: (status?.toUpperCase() ?? 'DRAFT') as never,
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
    const session = await getServerSession(authOptions)
    const authError = requireActiveSession(session)
    if (authError) return authError
    const role = (session!.user as { role?: string }).role
    if (!role || !['ADMIN', 'EDITOR'].includes(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const articles = await prisma.article.findMany({
      where: {
        status: requestedStatus as never,
        ...(category ? { category: { slug: category } } : {}),
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
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError
  if (!['ADMIN', 'EDITOR', 'WRITER'].includes(session!.user.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { title, slug: rawSlug, content, excerpt, coverImage, categoryId, status, tags } = body

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
        authorId:   session!.user.id,
        status:     status ?? 'DRAFT',
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    })

    // Handle tags if provided
    if (Array.isArray(tags) && tags.length > 0) {
      const tagRecords = await Promise.all(
        tags.map((name: string) => {
          const tagSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          return prisma.tag.upsert({
            where: { slug: tagSlug },
            update: {},
            create: { name, slug: tagSlug },
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
