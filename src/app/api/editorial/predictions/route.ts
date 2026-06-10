import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREDICTIONS_MANAGE_ROLES } from '@/lib/rbac'
import { DEFAULT_MAX_ERROR, semesterKeyForDate } from '@/lib/predictions'
import { parseEventFields } from './validate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/editorial/predictions
 * Creates a prediction event.
 * Body: { title, description?, type, fredSeriesId?, unitLabel, deadline,
 *         releaseDate, minValue, maxValue, maxError? }
 */
export async function POST(req: Request) {
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
  const fields = parseEventFields(parsed, { requireAll: true })
  if ('error' in fields) {
    return NextResponse.json({ error: fields.error }, { status: 400 })
  }

  const data = fields.data
  const event = await prisma.predictionEvent.create({
    data: {
      title: data.title!,
      description: data.description ?? null,
      type: data.type!,
      fredSeriesId: data.fredSeriesId ?? null,
      unitLabel: data.unitLabel!,
      deadline: data.deadline!,
      releaseDate: data.releaseDate!,
      minValue: data.minValue!,
      maxValue: data.maxValue!,
      maxError: data.maxError ?? DEFAULT_MAX_ERROR,
      semesterKey: semesterKeyForDate(data.deadline!),
      createdById: caller.id,
    },
    select: { id: true },
  })

  return NextResponse.json({ ok: true, id: event.id })
}
