import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const article = await prisma.article.findUnique({
      where: { id },
      include: { author: true, category: true },
    })
    if (!article) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(article)
  } catch {
    return Response.json({ error: 'Failed to fetch article' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const isAdminOrEditor = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  try {
    const existing = await prisma.article.findUnique({ where: { id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Writers can only edit their own articles
    if (!isAdminOrEditor && existing.authorId !== session.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { title, slug, content, excerpt, coverImage, categoryId, status } = body

    // Only editors/admins can publish
    let finalStatus = existing.status
    if (isAdminOrEditor && status) {
      finalStatus = status
    } else if (!isAdminOrEditor && status && status !== 'PUBLISHED') {
      finalStatus = status
    }

    const wasPublished = existing.status !== 'PUBLISHED' && finalStatus === 'PUBLISHED'
    const wasUnpublished = existing.status === 'PUBLISHED' && finalStatus !== 'PUBLISHED'

    const updated = await prisma.article.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug }),
        ...(content !== undefined && { content }),
        ...(excerpt !== undefined && { excerpt }),
        ...(coverImage !== undefined && { coverImage: coverImage || null }),
        ...(categoryId !== undefined && { categoryId: categoryId || null }),
        status: finalStatus,
        publishedAt: wasPublished
          ? new Date()
          : wasUnpublished
          ? null
          : existing.publishedAt,
      },
    })

    return Response.json(updated)
  } catch (error) {
    console.error('Update article error:', error)
    return Response.json({ error: 'Failed to update article' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const isAdminOrEditor = session.user.role === 'ADMIN' || session.user.role === 'EDITOR'

  try {
    const existing = await prisma.article.findUnique({ where: { id } })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!isAdminOrEditor && existing.authorId !== session.user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.article.delete({ where: { id } })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to delete article' }, { status: 500 })
  }
}
