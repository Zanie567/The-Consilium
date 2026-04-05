import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, { params }: Props) {
  const { id } = await params
  await prisma.$transaction([
    prisma.articleView.create({ data: { articleId: id } }),
    prisma.article.update({ where: { id }, data: { viewCount: { increment: 1 } } }),
  ])
  return NextResponse.json({ ok: true })
}
