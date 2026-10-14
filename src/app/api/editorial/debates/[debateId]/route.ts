import { withTestingAudit } from '@/lib/testingAudit'
import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { FEATURED_DEBATE_LOCK, revalidateDebateSurfaces } from '@/lib/debateLifecycle'
import { apiServerErrorResponse } from '@/lib/apiResponse'
import { withTransactionRetry } from '@/lib/transactionRetry'

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
    updatedAt: debate.updatedAt.toISOString(),
    unpublishedAt: debate.unpublishedAt?.toISOString() ?? null,
    deletedAt: debate.deletedAt?.toISOString() ?? null,
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

async function PATCHHandler(req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { debateId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { title, description, isActive, closesAt, expectedUpdatedAt } = body
  if ((title !== undefined && (typeof title !== 'string' || !title.trim())) ||
      (description !== undefined && description !== null && typeof description !== 'string') ||
      (isActive !== undefined && typeof isActive !== 'boolean') ||
      (closesAt !== undefined && closesAt !== null && (typeof closesAt !== 'string' || !Number.isFinite(new Date(closesAt).getTime()))) ||
      (expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string')) {
    return NextResponse.json({ error: 'Check the title, active status and closing date.' }, { status: 400 })
  }
  // A missing or invalid target must never deactivate another live debate.
  // Activation and the target update commit together, including on database failure.
  // The row is written only if it is still exactly as the editor loaded it.
  type Outcome =
    | { ok: true; debate: Awaited<ReturnType<typeof prisma.debate.update>> }
    | { ok: false; status: number; error: string }
  // Featuring a debate also un-features the current one: a global choice, so concurrent choices are serialized by a
  // transaction lock taken before any row lock (as the article feature route does). Without it two administrators
  // featuring different debates lock each other's rows in opposite orders and deadlock. Database work only, so a
  // conflict abort is retried; the cache refresh runs after the commit.
  let outcome: Outcome
  try {
    outcome = await withTransactionRetry('debate:edit', () => prisma.$transaction(async (tx): Promise<Outcome> => {
      // Before the read, not after it: the other featuring request changes this row's updatedAt when it un-features
      // it, so reading first would make the guarded write below refuse a perfectly valid request.
      if (isActive === true) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${FEATURED_DEBATE_LOCK}))`
      const existing = await tx.debate.findUnique({
        where: { id: debateId },
        select: { id: true, updatedAt: true, deletedAt: true, unpublishedAt: true },
      })
      if (!existing) return { ok: false, status: 404, error: 'Not found' }
      if (existing.deletedAt) return { ok: false, status: 409, error: 'This debate is deleted. Restore it before editing.' }
      if (expectedUpdatedAt && expectedUpdatedAt !== existing.updatedAt.toISOString()) {
        return { ok: false, status: 409, error: 'This debate changed since you opened it. Reload and review it before saving.' }
      }
      if (isActive === true && existing.unpublishedAt) {
        return { ok: false, status: 409, error: 'Publish this debate before making it the featured debate.' }
      }
      const data = {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(closesAt !== undefined && { closesAt: closesAt ? new Date(closesAt) : null }),
      }
      // Guarded on the row as read, so a concurrent edit or deletion is refused, not overwritten.
      const written = await tx.debate.updateMany({
        where: { id: debateId, updatedAt: existing.updatedAt, deletedAt: null },
        data,
      })
      if (written.count !== 1) return { ok: false, status: 409, error: 'This debate was changed at the same time. Reload and try again.' }
      if (isActive === true) {
        await tx.debate.updateMany({ where: { id: { not: debateId }, isActive: true }, data: { isActive: false } })
      }
      await tx.auditLog.create({
        data: {
          action: 'DEBATE_UPDATED',
          targetId: debateId,
          targetType: 'debate',
          performedBy: user.id,
          metadata: { fields: Object.keys(data) },
        },
      })
      return { ok: true, debate: await tx.debate.findUniqueOrThrow({ where: { id: debateId } }) }
    }))
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'debate:edit',
      userMessage: 'The debate could not be saved. Nothing was changed. Try again.',
      code: 'DEBATE_UPDATE_FAILED',
    })
  }
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  revalidateDebateSurfaces()
  return NextResponse.json(outcome.debate)
}

export const PATCH = withTestingAudit(PATCHHandler)
