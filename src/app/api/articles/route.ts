import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import slugify from 'slugify'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const status = searchParams.get('status')
  const category = searchParams.get('category')
  const take = parseInt(searchParams.get('take') ?? '20')

  try {
    const articles = await prisma.article.findMany({
      where: {
        ...(status ? { status: status as never } : { status: 'PUBLISHED' }),
        ...(category ? { category: { slug: category } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take,
      include: { author: true, category: true },
    })
    return Response.json(articles)
  } catch (error) {
    return Response.json({ error: 'Failed to fetch articles' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!['ADMIN', 'EDITOR', 'WRITER'].includes(session.user.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { title, slug: rawSlug, content, excerpt, coverImage, categoryId, status } = body

    if (!title) {
      return Response.json({ error: 'Title is required' }, { status: 400 })
    }

    const slug =
      rawSlug ||
      slugify(title, { lower: true, strict: true, trim: true })

    // Check slug uniqueness
    const existing = await prisma.article.findUnique({ where: { slug } })
    if (existing) {
      return Response.json({ error: 'Slug already exists. Choose a different title or slug.' }, { status: 400 })
    }

    const article = await prisma.article.create({
      data: {
        title,
        slug,
        content: content ?? '',
        excerpt: excerpt ?? null,
        coverImage: coverImage ?? null,
        categoryId: categoryId ?? null,
        authorId: session.user.id,
        status: status ?? 'DRAFT',
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
    })

    return Response.json(article, { status: 201 })
  } catch (error) {
    console.error('Create article error:', error)
    return Response.json({ error: 'Failed to create article' }, { status: 500 })
  }
}
