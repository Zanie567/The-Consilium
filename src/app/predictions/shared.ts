/**
 * Display helpers shared by the predictions pages.
 */

import type { PredictionEventStatus, PredictionEventType } from '@prisma/client'

export const EVENT_TYPE_LABELS: Record<PredictionEventType, string> = {
  BOE_RATE: 'Bank of England Rate',
  CPI_YOY: 'CPI Inflation',
  OTHER: 'Special Event',
}

export type EventDisplayState = 'Open' | 'Awaiting result' | 'Resolved' | 'Cancelled'

/**
 * Folds DB status and the deadline into the state a reader cares about. An
 * OPEN event past its deadline reads as awaiting result even before the cron
 * or an admin resolves it.
 */
export function eventDisplayState(
  event: { status: PredictionEventStatus; deadline: Date },
  now: Date = new Date()
): EventDisplayState {
  if (event.status === 'CANCELLED') return 'Cancelled'
  if (event.status === 'RESOLVED') return 'Resolved'
  if (event.status === 'OPEN' && now.getTime() < event.deadline.getTime()) return 'Open'
  return 'Awaiting result'
}

export const STATE_BADGE_CLASSES: Record<EventDisplayState, string> = {
  Open: 'bg-emerald-500/10 text-emerald-600',
  'Awaiting result': 'bg-amber-500/10 text-amber-600',
  Resolved: 'bg-gold/10 text-gold',
  Cancelled: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
}
