import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  // Remove featured from all others, set on this one
  await prisma.$transaction([
    prisma.article.updateMany({ data: { isFeatured: false } }),
    prisma.article.update({ where: { id }, data: { isFeatured: true } }),
  ])

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  await prisma.article.update({ where: { id }, data: { isFeatured: false } })
  return NextResponse.json({ ok: true })
}
