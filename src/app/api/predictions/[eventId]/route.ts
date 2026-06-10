import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_ACCESS_ROLES } from '@/lib/rbac'
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

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in to submit a prediction.' }, { status: 401 })
  }

  // Visibility gate: re-verified against the database, never trusted from the
  // JWT. The allowed roles live in PREDICTIONS_ACCESS_ROLES in src/lib/rbac.ts.
  // This also rejects inactive and banned accounts.
  const user = await getVerifiedSessionUser(PREDICTIONS_ACCESS_ROLES)
  if (!user) {
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
