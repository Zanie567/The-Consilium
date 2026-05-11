import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

export async function POST(req: Request) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const {
    title,
    description,
    isActive,
    closesAt,
    forTitle, forContent, forExcerpt, forAuthorId,
    againstTitle, againstContent, againstExcerpt, againstAuthorId,
    categoryId,
  } = body

  if (!title || !forTitle || !forContent || !againstTitle || !againstContent || !forAuthorId || !againstAuthorId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // If activating, deactivate all existing debates
  if (isActive) {
    await prisma.debate.updateMany({ data: { isActive: false } })
  }

  // Slugify helper
  function toSlug(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  }

  async function uniqueSlug(base: string) {
    let slug = base
    let i = 0
    while (await prisma.article.findUnique({ where: { slug } })) {
      i++
      slug = `${base}-${i}`
    }
    return slug
  }

  const forSlug = await uniqueSlug(toSlug(forTitle))
  const againstSlug = await uniqueSlug(toSlug(againstTitle))

  const [forArticle, againstArticle] = await Promise.all([
    prisma.article.create({
      data: {
        title: forTitle,
        slug: forSlug,
        content: forContent,
        excerpt: forExcerpt || null,
        authorId: forAuthorId,
        categoryId: categoryId || null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isDebate: true,
      },
    }),
    prisma.article.create({
      data: {
        title: againstTitle,
        slug: againstSlug,
        content: againstContent,
        excerpt: againstExcerpt || null,
        authorId: againstAuthorId,
        categoryId: categoryId || null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isDebate: true,
      },
    }),
  ])

  const debate = await prisma.debate.create({
    data: {
      title,
      description: description || null,
      forArticleId: forArticle.id,
      againstArticleId: againstArticle.id,
      isActive: isActive ?? false,
      closesAt: closesAt ? new Date(closesAt) : null,
    },
  })

  return NextResponse.json({ debate, forArticle, againstArticle }, { status: 201 })
}
