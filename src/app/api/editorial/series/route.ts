import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import slugify from 'slugify'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const series = await prisma.series.findMany({
    include: {
      articles: {
        where: { status: 'PUBLISHED' },
        select: { id: true, title: true, slug: true, seriesOrder: true },
        orderBy: { seriesOrder: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(series)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, description } = await req.json()
  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  }

  const slug = slugify(title, { lower: true, strict: true })
  const series = await prisma.series.create({
    data: { title: title.trim(), slug, description },
  })

  return NextResponse.json(series, { status: 201 })
}
