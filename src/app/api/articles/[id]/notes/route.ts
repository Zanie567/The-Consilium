import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { content, isPrivate } = await req.json()
  if (!content?.trim()) {
    return NextResponse.json({ error: 'Content required' }, { status: 400 })
  }

  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, categoryId: true },
  })
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  }

  if (session.user.role === 'EDITOR') {
    if (article.categoryId) {
      const assignment = await prisma.categoryEditor.findFirst({
        where: { userId: session.user.id, categoryId: article.categoryId },
      })
      if (!assignment) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else {
      const anyAssignment = await prisma.categoryEditor.findFirst({
        where: { userId: session.user.id },
      })
      if (anyAssignment) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  const note = await prisma.articleNote.create({
    data: {
      articleId: article.id,
      authorId: session.user.id,
      content: content.trim(),
      isPrivate: isPrivate ?? false,
    },
    include: { author: { select: { name: true } } },
  })

  return NextResponse.json(note, { status: 201 })
}
