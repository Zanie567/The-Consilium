import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CALENDAR_ACCESS_ROLES } from '@/lib/rbac'
import { isRealCalendarDate, moveToEditorialDate } from '@/lib/editorialCalendar'

/**
 * PATCH /api/editorial/calendar
 * Moves a SCHEDULED article to another calendar day. The wall clock time
 * (in the editorial time zone) is kept, only the date changes.
 * Body: { articleId: string, date: "YYYY-MM-DD" }
 */
export async function PATCH(req: Request) {
  // Role gate: re-verified against the database on every call. The allowed
  // roles live in CALENDAR_ACCESS_ROLES in src/lib/rbac.ts.
  const caller = await getVerifiedSessionUser(CALENDAR_ACCESS_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { articleId?: unknown; date?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { articleId, date } = body
  if (typeof articleId !== 'string' || !articleId) {
    return NextResponse.json({ error: 'articleId is required.' }, { status: 400 })
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be in YYYY-MM-DD format.' }, { status: 400 })
  }
  if (!isRealCalendarDate(date)) {
    return NextResponse.json({ error: 'That is not a valid calendar date.' }, { status: 400 })
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, status: true, scheduledAt: true, deletedAt: true },
  })
  if (!article || article.deletedAt) {
    return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
  }
  if (article.status !== 'SCHEDULED' || !article.scheduledAt) {
    return NextResponse.json(
      { error: 'Only scheduled articles with a publish time can be moved.' },
      { status: 400 },
    )
  }

  const nextScheduledAt = moveToEditorialDate(article.scheduledAt, date)
  if (!nextScheduledAt) {
    return NextResponse.json(
      { error: 'That time does not exist on the chosen day (daylight saving change). Edit the article to pick a new time.' },
      { status: 400 },
    )
  }

  const updated = await prisma.article.update({
    where: { id: article.id },
    data: { scheduledAt: nextScheduledAt },
    select: { id: true, scheduledAt: true },
  })

  return NextResponse.json({
    id: updated.id,
    scheduledAt: updated.scheduledAt?.toISOString() ?? null,
  })
}
