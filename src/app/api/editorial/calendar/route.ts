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

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  // req.json() resolves for any valid JSON, including null, "x", or [].
  // Destructuring null throws, so require a plain object before reading fields.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { articleId, date } = parsed as { articleId?: unknown; date?: unknown }
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

  // Mirror the future-only rule enforced when an article is first scheduled:
  // a move that lands in the past would make the publish cron fire on its
  // next run and publish the article immediately, which is never what a
  // drag on the calendar means.
  if (nextScheduledAt <= new Date()) {
    return NextResponse.json(
      { error: 'That would schedule the article in the past. Pick a future day, or edit the article to publish it now.' },
      { status: 400 },
    )
  }

  // Compare-and-set: only write if the article is still the scheduled article
  // the move was computed from. A concurrent publish, delete, or reschedule
  // (for example the publish cron firing) makes this a no-op instead of
  // overwriting the newer state with a time based on a stale read.
  const { count } = await prisma.article.updateMany({
    where: {
      id: article.id,
      status: 'SCHEDULED',
      deletedAt: null,
      scheduledAt: article.scheduledAt,
    },
    data: { scheduledAt: nextScheduledAt },
  })
  if (count === 0) {
    return NextResponse.json(
      { error: 'The article changed while you were moving it. Refresh the calendar and try again.' },
      { status: 409 },
    )
  }

  return NextResponse.json({
    id: article.id,
    scheduledAt: nextScheduledAt.toISOString(),
  })
}
