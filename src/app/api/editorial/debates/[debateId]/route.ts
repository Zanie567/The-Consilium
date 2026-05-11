import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ debateId: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { debateId } = await params

  const debate = await prisma.debate.findUnique({
    where: { id: debateId },
    include: {
      forArticle: { select: { title: true, slug: true } },
      againstArticle: { select: { title: true, slug: true } },
      votes: { select: { side: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
  })

  if (!debate) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forCount = debate.votes.filter((v) => v.side === 'FOR').length
  const againstCount = debate.votes.filter((v) => v.side === 'AGAINST').length
  const total = forCount + againstCount

  return NextResponse.json({
    id: debate.id,
    title: debate.title,
    description: debate.description,
    isActive: debate.isActive,
    closesAt: debate.closesAt?.toISOString() ?? null,
    createdAt: debate.createdAt.toISOString(),
    forArticle: debate.forArticle,
    againstArticle: debate.againstArticle,
    totalVotes: total,
    forCount,
    againstCount,
    forPct: total > 0 ? Math.round((forCount / total) * 100) : 0,
    againstPct: total > 0 ? Math.round((againstCount / total) * 100) : 0,
    votes: debate.votes.map((v) => ({ side: v.side, createdAt: v.createdAt.toISOString() })),
  })
}

export async function PATCH(req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { debateId } = await params
  const body = await req.json()
  const { title, description, isActive, closesAt } = body

  // If activating this debate, deactivate all others first
  if (isActive) {
    await prisma.debate.updateMany({ where: { id: { not: debateId } }, data: { isActive: false } })
  }

  const updated = await prisma.debate.update({
    where: { id: debateId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
      ...(closesAt !== undefined && { closesAt: closesAt ? new Date(closesAt) : null }),
    },
  })

  return NextResponse.json(updated)
}
