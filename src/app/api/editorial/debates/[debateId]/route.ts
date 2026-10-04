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
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { title, description, isActive, closesAt } = body
  if ((title !== undefined && (typeof title !== 'string' || !title.trim())) ||
      (description !== undefined && description !== null && typeof description !== 'string') ||
      (isActive !== undefined && typeof isActive !== 'boolean') ||
      (closesAt !== undefined && closesAt !== null && (typeof closesAt !== 'string' || !Number.isFinite(new Date(closesAt).getTime())))) {
    return NextResponse.json({ error: 'Check the title, active status and closing date.' }, { status: 400 })
  }
  // A missing or invalid target must never deactivate another live debate.
  // Activation and the target update commit together, including on database failure.
  const updated = await prisma.$transaction(async tx => {
    const existing = await tx.debate.findUnique({ where: { id: debateId }, select: { id: true } })
    if (!existing) return null
    if (isActive === true) {
      await tx.debate.updateMany({ where: { id: { not: debateId } }, data: { isActive: false } })
    }
    return tx.debate.update({
      where: { id: debateId },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(closesAt !== undefined && { closesAt: closesAt ? new Date(closesAt) : null }),
      },
    })
  })
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}
