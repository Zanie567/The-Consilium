'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { addMonths, monthLabel, type CalendarDay } from '@/lib/editorialCalendar'
import { EDITORIAL_TIME_ZONE_LABEL } from '@/lib/editorialSchedule'

export interface CalendarItem {
  id: string
  title: string
  status: string
  authorName: string
  categoryName: string | null
  /** "HH:mm" in the editorial time zone, empty for unscheduled items. */
  timeLabel: string
  /** "YYYY-MM-DD" in the editorial time zone, null for unscheduled items. */
  dateKey: string | null
}

interface Props {
  month: string
  weeks: CalendarDay[][]
  itemsByDay: Record<string, CalendarItem[]>
  unscheduled: CalendarItem[]
  unscheduledTotal: number
  todayKey: string
  fetchError: boolean
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const CHIP_STYLE: Record<string, string> = {
  SCHEDULED: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  PUBLISHED: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  DRAFT: 'border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
  PENDING_REVIEW: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

const DOT_STYLE: Record<string, string> = {
  SCHEDULED: 'bg-blue-500',
  PUBLISHED: 'bg-emerald-500',
  DRAFT: 'bg-[var(--fg-faint)]',
  PENDING_REVIEW: 'bg-amber-500',
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  DRAFT: 'Draft',
  PENDING_REVIEW: 'In review',
}

// Set via inline style, not a Tailwind class: the portal's global stylesheet has
// an unlayered "a { cursor: pointer }" rule that beats layered utility classes,
// so cursor-grab as a class would never apply to these anchor chips.
const GRAB_CURSOR = { cursor: 'grab' as const }

const MAX_CHIPS_PER_CELL = 3
const PANEL_WIDTH = 320
const PANEL_MAX_HEIGHT = 380

function formatDayHeading(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function CalendarView({
  month,
  weeks,
  itemsByDay,
  unscheduled,
  unscheduledTotal,
  todayKey,
  fetchError,
}: Props) {
  const router = useRouter()

  // Optimistic drag moves (article id to its new day) layered over the
  // server data, cleared whenever fresh server data arrives.
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dayPanel, setDayPanel] = useState<{ key: string; left: number; top: number } | null>(null)

  useEffect(() => {
    setMoves({})
  }, [itemsByDay])

  // Close the day panel when the month changes so it never shows a stale day.
  useEffect(() => {
    setDayPanel(null)
  }, [month])

  useEffect(() => {
    if (!dayPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDayPanel(null)
    }
    // The panel is anchored to where its day cell was when opened. Closing on
    // scroll keeps it from drifting away from that cell.
    const onScroll = () => setDayPanel(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [dayPanel])

  const itemById = useMemo(() => {
    const map = new Map<string, CalendarItem>()
    for (const list of Object.values(itemsByDay)) {
      for (const item of list) map.set(item.id, item)
    }
    return map
  }, [itemsByDay])

  const effectiveByDay = useMemo(() => {
    if (Object.keys(moves).length === 0) return itemsByDay
    const map: Record<string, CalendarItem[]> = {}
    for (const [key, list] of Object.entries(itemsByDay)) {
      map[key] = list.filter((item) => (moves[item.id] ?? key) === key)
    }
    for (const list of Object.values(itemsByDay)) {
      for (const item of list) {
        const target = moves[item.id]
        if (target && target !== item.dateKey) {
          ;(map[target] ??= []).push({ ...item, dateKey: target })
        }
      }
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel) || a.title.localeCompare(b.title))
    }
    return map
  }, [itemsByDay, moves])

  const openDayPanel = (key: string, cell: HTMLElement) => {
    const rect = cell.getBoundingClientRect()
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - PANEL_WIDTH - 8)
    let top = rect.bottom + 6
    if (top + PANEL_MAX_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, rect.top - PANEL_MAX_HEIGHT - 6)
    }
    setDayPanel({ key, left, top })
  }

  const handleDrop = async (targetKey: string) => {
    const id = draggingId
    setDraggingId(null)
    setDragOverKey(null)
    if (!id) return
    const item = itemById.get(id)
    if (!item || item.status !== 'SCHEDULED') return
    const currentKey = moves[id] ?? item.dateKey
    if (currentKey === targetKey) return

    setMoves((prev) => ({ ...prev, [id]: targetKey }))
    setPendingIds((prev) => new Set(prev).add(id))
    setError(null)
    try {
      const res = await fetch('/api/editorial/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: id, date: targetKey }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(
          (data as { error?: string } | null)?.error ?? 'The article could not be moved.',
        )
      }
      router.refresh()
    } catch (err) {
      setMoves((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setError(err instanceof Error ? err.message : 'The article could not be moved.')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const panelItems = dayPanel ? effectiveByDay[dayPanel.key] ?? [] : []

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-[1400px]">
      <PortalSection className="mb-5 pl-10 md:pl-0 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Editorial Calendar
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            Scheduled and published work at a glance. All times are {EDITORIAL_TIME_ZONE_LABEL}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/editorial/calendar"
            className="px-3 py-2 text-xs font-semibold uppercase tracking-wider border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors min-h-[40px] flex items-center"
          >
            Today
          </Link>
          <Link
            href={`/editorial/calendar?month=${addMonths(month, -1)}`}
            aria-label={`Go to ${monthLabel(addMonths(month, -1))}`}
            className="p-2.5 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors"
          >
            <ChevronLeft size={16} />
          </Link>
          <span
            className="text-lg font-bold text-[var(--fg)] min-w-[170px] text-center"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {monthLabel(month)}
          </span>
          <Link
            href={`/editorial/calendar?month=${addMonths(month, 1)}`}
            aria-label={`Go to ${monthLabel(addMonths(month, 1))}`}
            className="p-2.5 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </PortalSection>

      {fetchError && (
        <PortalSection className="mb-4">
          <div className="bg-red-500/10 border border-red-500/20 px-5 py-4 text-red-600 dark:text-red-400 text-sm">
            The calendar could not be loaded. This is usually a temporary database issue.
            Please refresh the page.
          </div>
        </PortalSection>
      )}

      {error && (
        <PortalSection className="mb-4">
          <div className="bg-red-500/10 border border-red-500/20 px-5 py-3 text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-4">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs font-semibold uppercase tracking-wider hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        </PortalSection>
      )}

      {/* Legend */}
      <PortalSection className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--fg-muted)]">
        {(['SCHEDULED', 'PUBLISHED', 'PENDING_REVIEW', 'DRAFT'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${DOT_STYLE[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-full leading-none">
            2+
          </span>
          Busy day (two or more pieces)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-4 h-3 border border-[var(--border)]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)',
            }}
          />
          Open weekday (nothing planned)
        </span>
      </PortalSection>

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* Month grid */}
        <PortalSection className="flex-1 w-full min-w-0">
          <div className="overflow-x-auto">
            <div className="min-w-[720px] border border-[var(--border)] bg-[var(--bg-elevated)]">
              <div className="grid grid-cols-7 border-b border-[var(--border)]">
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-faint)] text-center"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {weeks.map((week, wi) => (
                <div
                  key={week[0].key}
                  className={`grid grid-cols-7 ${wi > 0 ? 'border-t border-[var(--border)]' : ''}`}
                >
                  {week.map((day, di) => {
                    const items = effectiveByDay[day.key] ?? []
                    const isToday = day.key === todayKey
                    const isBusy = items.length >= 2
                    const isOpenGap = day.inMonth && !day.isWeekend && items.length === 0
                    const isDropTarget = dragOverKey === day.key && draggingId !== null
                    const overflow = items.length - MAX_CHIPS_PER_CELL

                    return (
                      <div
                        key={day.key}
                        role="button"
                        tabIndex={0}
                        aria-label={`${formatDayHeading(day.key)}, ${items.length === 0 ? 'nothing planned' : `${items.length} item${items.length === 1 ? '' : 's'}`}`}
                        onClick={(e) => openDayPanel(day.key, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openDayPanel(day.key, e.currentTarget)
                          }
                        }}
                        onDragOver={(e) => {
                          if (!draggingId) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (dragOverKey !== day.key) setDragOverKey(day.key)
                        }}
                        onDragLeave={(e) => {
                          // Ignore moves onto the cell's own children, only
                          // clear when the drag truly leaves the cell.
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return
                          if (dragOverKey === day.key) setDragOverKey(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          void handleDrop(day.key)
                        }}
                        className={[
                          'min-h-[112px] lg:min-h-[124px] p-1.5 flex flex-col gap-1 cursor-pointer text-left align-top',
                          di > 0 ? 'border-l border-[var(--border)]' : '',
                          day.inMonth ? '' : 'opacity-45',
                          day.isWeekend && day.inMonth ? 'bg-[var(--bg-subtle)]/50' : '',
                          isDropTarget
                            ? 'ring-2 ring-inset ring-gold bg-gold/10'
                            : 'hover:bg-[var(--bg-subtle)]/60',
                        ].join(' ')}
                        style={
                          isOpenGap && !isDropTarget
                            ? {
                                backgroundImage:
                                  'repeating-linear-gradient(45deg, transparent, transparent 7px, var(--border) 7px, var(--border) 8px)',
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={[
                              'text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full',
                              isToday
                                ? 'bg-gold text-navy'
                                : day.inMonth
                                ? 'text-[var(--fg-muted)]'
                                : 'text-[var(--fg-faint)]',
                            ].join(' ')}
                          >
                            {day.dayOfMonth}
                          </span>
                          {isBusy && (
                            <span
                              title={`${items.length} pieces land on this day`}
                              className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-full leading-none"
                            >
                              {items.length}
                            </span>
                          )}
                        </div>

                        {items.slice(0, MAX_CHIPS_PER_CELL).map((item) => (
                          <Link
                            key={item.id}
                            href={`/editorial/articles/${item.id}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            draggable={item.status === 'SCHEDULED'}
                            onDragStart={(e) => {
                              if (item.status !== 'SCHEDULED') return
                              e.dataTransfer.setData('text/plain', item.id)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggingId(item.id)
                            }}
                            onDragEnd={() => {
                              setDraggingId(null)
                              setDragOverKey(null)
                            }}
                            title={`${item.title} (${STATUS_LABEL[item.status] ?? item.status}${item.timeLabel ? `, ${item.timeLabel}` : ''})`}
                            className={[
                              'block border-l-2 px-1.5 py-1 text-[11px] leading-tight hover:opacity-80 transition-opacity',
                              CHIP_STYLE[item.status] ?? CHIP_STYLE.DRAFT,
                              pendingIds.has(item.id) ? 'opacity-50 animate-pulse' : '',
                            ].join(' ')}
                            style={item.status === 'SCHEDULED' ? GRAB_CURSOR : undefined}
                          >
                            <span className="block font-semibold truncate">
                              {item.timeLabel && (
                                <span className="font-normal opacity-70">{item.timeLabel} </span>
                              )}
                              {item.title}
                            </span>
                            <span className="block truncate opacity-70">
                              {item.authorName}
                              {item.categoryName ? ` · ${item.categoryName}` : ''}
                            </span>
                          </Link>
                        ))}

                        {overflow > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openDayPanel(day.key, e.currentTarget.closest('[role="button"]') as HTMLElement)
                            }}
                            className="text-left text-[11px] font-semibold text-[var(--fg-muted)] hover:text-gold px-1.5"
                          >
                            +{overflow} more
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-[var(--fg-faint)]">
            Drag a scheduled article to another day to move it. The publish time stays the same.
          </p>
        </PortalSection>

        {/* Unscheduled tray */}
        <PortalSection className="w-full xl:w-72 shrink-0">
          <div className="border border-[var(--border)] bg-[var(--bg-elevated)]">
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
              <Inbox size={14} className="text-[var(--fg-faint)]" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                Unscheduled
              </h2>
              <span className="ml-auto text-[11px] text-[var(--fg-faint)]">{unscheduledTotal}</span>
            </div>
            {unscheduled.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-[var(--fg-faint)]">
                No drafts or pieces in review right now. Everything has a date.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)] max-h-[560px] overflow-y-auto">
                {unscheduled.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/editorial/articles/${item.id}/edit`}
                      className="block px-4 py-2.5 hover:bg-[var(--bg-subtle)] transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_STYLE[item.status] ?? DOT_STYLE.DRAFT}`} />
                        <span className="text-[12px] font-semibold text-[var(--fg)] truncate">
                          {item.title}
                        </span>
                      </span>
                      <span className="block text-[11px] text-[var(--fg-faint)] truncate mt-0.5 pl-3.5">
                        {STATUS_LABEL[item.status] ?? item.status} · {item.authorName}
                        {item.categoryName ? ` · ${item.categoryName}` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {unscheduledTotal > unscheduled.length && (
              <p className="px-4 py-2 border-t border-[var(--border)] text-[11px] text-[var(--fg-faint)]">
                Showing the {unscheduled.length} most recently updated of {unscheduledTotal}.
              </p>
            )}
          </div>
        </PortalSection>
      </div>

      {/* Day detail popover */}
      {dayPanel && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setDayPanel(null)}
          />
          <div
            role="dialog"
            aria-label={`Details for ${formatDayHeading(dayPanel.key)}`}
            className="fixed z-50 border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl"
            style={{
              left: dayPanel.left,
              top: dayPanel.top,
              width: PANEL_WIDTH,
              maxHeight: PANEL_MAX_HEIGHT,
              overflowY: 'auto',
            }}
          >
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3 sticky top-0 bg-[var(--bg-elevated)]">
              <h3
                className="text-sm font-bold text-[var(--fg)]"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {formatDayHeading(dayPanel.key)}
              </h3>
              <button
                onClick={() => setDayPanel(null)}
                aria-label="Close day details"
                className="text-[var(--fg-faint)] hover:text-[var(--fg)] text-lg leading-none px-1"
              >
                ×
              </button>
            </div>
            {panelItems.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--fg-faint)]">
                Nothing scheduled or published on this day.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {panelItems.map((item) => (
                  <li key={item.id} className="px-4 py-3">
                    <span className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-sm border-l-2 ${CHIP_STYLE[item.status] ?? CHIP_STYLE.DRAFT}`}
                      >
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                      {item.timeLabel && (
                        <span className="text-[11px] text-[var(--fg-muted)]">{item.timeLabel}</span>
                      )}
                    </span>
                    <Link
                      href={`/editorial/articles/${item.id}/edit`}
                      className="block text-[13px] font-semibold text-[var(--fg)] hover:text-gold transition-colors"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {item.title}
                    </Link>
                    <p className="text-[11px] text-[var(--fg-faint)] mt-0.5">
                      {item.authorName}
                      {item.categoryName ? ` · ${item.categoryName}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </PortalPage>
  )
}
