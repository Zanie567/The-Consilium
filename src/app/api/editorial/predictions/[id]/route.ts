import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_MANAGE_ROLES } from '@/lib/rbac'
import { semesterKeyForDate } from '@/lib/predictions'
import { resolvePredictionEvent } from '@/lib/predictionResolve'
import { parseEventFields } from '../validate'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/editorial/predictions/[id]
 * Manages a prediction event. Body: { action, ...fields }
 *
 * Actions:
 *   update  - edit event fields (allowed while OPEN or CLOSED)
 *   close   - stop taking predictions early (OPEN -> CLOSED)
 *   reopen  - resume taking predictions (CLOSED -> OPEN)
 *   cancel  - void the event, no scoring (OPEN or CLOSED -> CANCELLED)
 *   resolve - record the actual value and score everyone (manual resolution
 *             for events with no FRED series, or to override the cron)
 */
export async function PATCH(req: Request, { params }: Props) {
  const { id } = await params

  // Role gate: re-verified against the database on every call. The allowed
  // roles live in PREDICTIONS_MANAGE_ROLES in src/lib/rbac.ts.
  const caller = await getVerifiedSessionUser(PREDICTIONS_MANAGE_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
  const body = parsed as Record<string, unknown>
  const action = body.action

  const event = await prisma.predictionEvent.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      deadline: true,
      releaseDate: true,
      minValue: true,
      maxValue: true,
    },
  })
  if (!event) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  }

  if (action === 'close') {
    if (event.status !== 'OPEN') {
      return NextResponse.json({ error: 'Only open events can be closed.' }, { status: 409 })
    }
    await prisma.predictionEvent.update({ where: { id }, data: { status: 'CLOSED' } })
    return NextResponse.json({ ok: true, status: 'CLOSED' })
  }

  if (action === 'reopen') {
    if (event.status !== 'CLOSED') {
      return NextResponse.json({ error: 'Only closed events can be reopened.' }, { status: 409 })
    }
    await prisma.predictionEvent.update({ where: { id }, data: { status: 'OPEN' } })
    return NextResponse.json({ ok: true, status: 'OPEN' })
  }

  if (action === 'cancel') {
    if (event.status !== 'OPEN' && event.status !== 'CLOSED') {
      return NextResponse.json(
        { error: 'Resolved or cancelled events cannot be cancelled.' },
        { status: 409 }
      )
    }
    await prisma.predictionEvent.update({ where: { id }, data: { status: 'CANCELLED' } })
    return NextResponse.json({ ok: true, status: 'CANCELLED' })
  }

  if (action === 'resolve') {
    const raw = body.actualValue
    const actualValue =
      typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(actualValue)) {
      return NextResponse.json({ error: 'Actual value must be a number.' }, { status: 400 })
    }
    const outcome = await resolvePredictionEvent(id, actualValue)
    if (!outcome.resolved) {
      return NextResponse.json({ error: outcome.reason }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: 'RESOLVED', scored: outcome.scored })
  }

  if (action === 'update') {
    if (event.status !== 'OPEN' && event.status !== 'CLOSED') {
      return NextResponse.json(
        { error: 'Resolved or cancelled events cannot be edited.' },
        { status: 409 }
      )
    }
    const fields = parseEventFields(body, { requireAll: false })
    if ('error' in fields) {
      return NextResponse.json({ error: fields.error }, { status: 400 })
    }
    const data = fields.data

    // Re-check cross-field rules against the stored row when a partial update
    // only touches one side of a pair.
    const minValue = data.minValue ?? Number(event.minValue)
    const maxValue = data.maxValue ?? Number(event.maxValue)
    if (minValue >= maxValue) {
      return NextResponse.json({ error: 'Minimum value must be below maximum value.' }, { status: 400 })
    }
    const deadline = data.deadline ?? event.deadline
    const releaseDate = data.releaseDate ?? event.releaseDate
    if (deadline.getTime() > releaseDate.getTime()) {
      return NextResponse.json(
        { error: 'The deadline must be on or before the expected release date.' },
        { status: 400 }
      )
    }

    await prisma.predictionEvent.update({
      where: { id },
      data: {
        ...data,
        // Keep the semester key in step when the deadline moves.
        ...(data.deadline ? { semesterKey: semesterKeyForDate(data.deadline) } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json(
    { error: 'action must be update, close, reopen, cancel, or resolve.' },
    { status: 400 }
  )
}
