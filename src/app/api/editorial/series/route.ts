import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import slugify from 'slugify'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

export async function GET() {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
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
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
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
