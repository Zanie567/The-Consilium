import { notFound } from 'next/navigation'
import { getVerifiedSessionUser } from '@/lib/auth'
import { CALENDAR_ACCESS_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import {
  buildMonthGrid,
  currentEditorialMonth,
  editorialDateKey,
  editorialTimeLabel,
  gridUtcRange,
  isValidMonthParam,
} from '@/lib/editorialCalendar'
import { CalendarView, type CalendarItem } from '@/components/editorial/CalendarView'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Editorial Calendar | Editorial',
  robots: { index: false, follow: false },
}

const UNSCHEDULED_LIMIT = 60

export default async function EditorialCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  // Role gate: re-verified against the database, never trusted from the JWT.
  // The allowed roles live in CALENDAR_ACCESS_ROLES in src/lib/rbac.ts.
  const user = await getVerifiedSessionUser(CALENDAR_ACCESS_ROLES)
  if (!user) notFound()

  const { month: monthParam } = await searchParams
  const month =
    monthParam && isValidMonthParam(monthParam) ? monthParam : currentEditorialMonth()

  const weeks = buildMonthGrid(month)
  const { start, end } = gridUtcRange(weeks)

  let fetchError = false
  const [dated, unscheduled, unscheduledTotal] = await Promise.all([
    // One range query covers every visible cell, including spillover days
    // from the neighbouring months, so the grid never shows half a week.
    prisma.article.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: 'SCHEDULED', scheduledAt: { gte: start, lt: end } },
          { status: 'PUBLISHED', publishedAt: { gte: start, lt: end } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: [{ scheduledAt: 'asc' }, { publishedAt: 'asc' }],
    }),
    prisma.article.findMany({
      where: { deletedAt: null, status: { in: ['DRAFT', 'PENDING_REVIEW'] } },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        author: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: UNSCHEDULED_LIMIT,
    }),
    prisma.article.count({
      where: { deletedAt: null, status: { in: ['DRAFT', 'PENDING_REVIEW'] } },
    }),
  ]).catch((err: unknown): [[], [], number] => {
    console.error('[editorial/calendar] DB error:', err)
    fetchError = true
    return [[], [], 0]
  })

  const itemsByDay: Record<string, CalendarItem[]> = {}
  for (const article of dated) {
    const anchor = article.status === 'PUBLISHED' ? article.publishedAt : article.scheduledAt
    if (!anchor) continue
    const key = editorialDateKey(anchor)
    const item: CalendarItem = {
      id: article.id,
      title: article.title?.trim() || '(Untitled)',
      status: article.status,
      authorName: article.author?.name ?? 'Unknown author',
      categoryName: article.category?.name ?? null,
      timeLabel: editorialTimeLabel(anchor),
      dateKey: key,
    }
    ;(itemsByDay[key] ??= []).push(item)
  }
  for (const list of Object.values(itemsByDay)) {
    list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel) || a.title.localeCompare(b.title))
  }

  const unscheduledItems: CalendarItem[] = unscheduled.map((article) => ({
    id: article.id,
    title: article.title?.trim() || '(Untitled)',
    status: article.status,
    authorName: article.author?.name ?? 'Unknown author',
    categoryName: article.category?.name ?? null,
    timeLabel: '',
    dateKey: null,
  }))

  return (
    <CalendarView
      month={month}
      weeks={weeks}
      itemsByDay={itemsByDay}
      unscheduled={unscheduledItems}
      unscheduledTotal={unscheduledTotal}
      todayKey={editorialDateKey(new Date())}
      fetchError={fetchError}
    />
  )
}
