import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_ACCESS_ROLES, isAllowedRole } from '@/lib/rbac'
import { validateSubmission } from '@/lib/predictions'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ eventId: string }>
}

/**
 * POST /api/predictions/[eventId]
 * Submits or revises the caller's prediction for an event.
 * Body: { value: number }
 *
 * One prediction per user per event, enforced by the unique constraint on
 * (eventId, userId) and handled here as an upsert. Revisions are free until
 * the deadline; after that every write is rejected server-side.
 */
export async function POST(req: Request, { params }: Props) {
  const { eventId } = await params

  // Visibility gate: re-verified against the database, never trusted from the
  // JWT. This also rejects inactive and banned accounts.
  //
  // The role check is deliberately NOT delegated to requireVerifiedSessionUser:
  // predictions are an admin-only trial, and a 403 would confirm the feature
  // exists to anyone signed in. A role mismatch is reported as 404, exactly as
  // an unknown event would be. Authentication failures keep their own 401.
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response
  const user = auth.user

  if (!isAllowedRole(user.role, PREDICTIONS_ACCESS_ROLES)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const { value: rawValue } = parsed as { value?: unknown }

  const event = await prisma.predictionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      deadline: true,
      minValue: true,
      maxValue: true,
      unitLabel: true,
    },
  })
  if (!event) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  }

  const check = validateSubmission(
    rawValue,
    {
      status: event.status,
      deadline: event.deadline,
      minValue: Number(event.minValue),
      maxValue: Number(event.maxValue),
      unitLabel: event.unitLabel,
    },
    new Date()
  )
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 })
  }

  // The event is validated above without a row lock. A write racing an admin
  // deadline change or a resolve can at worst land with updatedAt past the
  // deadline, and scoring awards such rows zero points and no rank (see
  // computeScores), so the race cannot affect outcomes and submissions never
  // contend on the event row.
  const prediction = await prisma.prediction.upsert({
    where: { eventId_userId: { eventId, userId: user.id } },
    create: { eventId, userId: user.id, value: check.value },
    update: { value: check.value },
    select: { value: true, updatedAt: true },
  })

  return NextResponse.json({
    ok: true,
    value: Number(prediction.value),
    updatedAt: prediction.updatedAt.toISOString(),
  })
}
