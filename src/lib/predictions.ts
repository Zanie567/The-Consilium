/**
 * Reader predictions league: scoring, semester, and validation helpers.
 *
 * Everything in this file is a pure function so the scoring rules and the
 * deadline enforcement can be unit tested without a database. The DB side of
 * resolution lives in src/lib/predictionResolve.ts.
 */

/** Points awarded for an exact prediction. */
export const MAX_POINTS = 100

/** Default per-event maximum error when the admin does not set one. */
export const DEFAULT_MAX_ERROR = 1.0

// ── Semester key ──────────────────────────────────────────────────────────────

/**
 * Derives the semester key for a date, e.g. "2026-S1".
 *
 * S1 covers January through June, S2 covers July through December (UTC). This
 * helper is the single place that defines semester boundaries; the key is
 * stamped onto each event at creation so historical leaderboards stay stable
 * even if the boundaries change later.
 */
export function semesterKeyForDate(date: Date): string {
  const year = date.getUTCFullYear()
  const half = date.getUTCMonth() < 6 ? 'S1' : 'S2'
  return `${year}-${half}`
}

/** Human label for a semester key, e.g. "2026, January to June". */
export function semesterLabel(key: string): string {
  const match = /^(\d{4})-S([12])$/.exec(key)
  if (!match) return key
  const [, year, half] = match
  return half === '1' ? `${year}, January to June` : `${year}, July to December`
}

/** True when the key looks like a semester key this app produces. */
export function isValidSemesterKey(key: string): boolean {
  return /^\d{4}-S[12]$/.test(key)
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** 0 to MAX_POINTS, rounded to 2 decimal places. */
  points: number
  /** Absolute error, rounded to 4 decimal places. */
  absError: number
}

/**
 * Scores a single prediction against the actual value.
 *
 * Full points for an exact match, scaling down linearly to zero at maxError.
 * Anything at or beyond maxError scores zero. Ties are allowed by design.
 */
export function scorePrediction(
  predicted: number,
  actual: number,
  maxError: number
): ScoreBreakdown {
  const absError = round(Math.abs(predicted - actual), 4)
  if (!(maxError > 0)) {
    // Degenerate configuration: only an exact answer can score.
    return { points: absError === 0 ? MAX_POINTS : 0, absError }
  }
  const points = round(MAX_POINTS * Math.max(0, 1 - absError / maxError), 2)
  return { points, absError }
}

export interface ScorablePrediction {
  id: string
  value: number
  /** Last write to the prediction. Used to enforce the deadline at scoring time. */
  updatedAt: Date
}

export interface ScoredPrediction extends ScoreBreakdown {
  id: string
  /** 1-based rank within the event; ties share a rank. Null for late rows. */
  rank: number | null
  /** True when the row was last written after the deadline and scored zero. */
  late: boolean
}

/**
 * Scores every prediction for an event in one pass.
 *
 * Predictions last written after the deadline never receive points or a rank,
 * no matter how the row came to exist; this is the final guard behind the API
 * level deadline check. On-time predictions are ranked by absolute error with
 * standard competition ranking (tied errors share a rank, the next rank skips).
 */
export function computeScores(
  predictions: ScorablePrediction[],
  actual: number,
  maxError: number,
  deadline: Date
): ScoredPrediction[] {
  const onTime: ScoredPrediction[] = []
  const late: ScoredPrediction[] = []

  for (const p of predictions) {
    const { points, absError } = scorePrediction(p.value, actual, maxError)
    if (p.updatedAt.getTime() > deadline.getTime()) {
      late.push({ id: p.id, points: 0, absError, rank: null, late: true })
    } else {
      onTime.push({ id: p.id, points, absError, rank: null, late: false })
    }
  }

  onTime.sort((a, b) => a.absError - b.absError)
  for (let i = 0; i < onTime.length; i++) {
    onTime[i].rank =
      i > 0 && onTime[i].absError === onTime[i - 1].absError
        ? onTime[i - 1].rank
        : i + 1
  }

  return [...onTime, ...late]
}

// ── Submission validation ─────────────────────────────────────────────────────

export interface SubmissionEvent {
  status: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'CANCELLED'
  deadline: Date
  minValue: number
  maxValue: number
  unitLabel: string
}

export type SubmissionCheck =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Server-side validation for a prediction submission. Returns the parsed
 * numeric value on success, or a human readable error on failure.
 */
export function validateSubmission(
  raw: unknown,
  event: SubmissionEvent,
  now: Date
): SubmissionCheck {
  if (event.status !== 'OPEN') {
    return { ok: false, error: 'This event is no longer taking predictions.' }
  }
  if (now.getTime() >= event.deadline.getTime()) {
    return { ok: false, error: 'The deadline for this event has passed.' }
  }
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (typeof raw === 'string' && raw.trim() === '') {
    return { ok: false, error: 'Enter a number.' }
  }
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'Enter a number.' }
  }
  if (value < event.minValue || value > event.maxValue) {
    return {
      ok: false,
      error: `Predictions must be between ${event.minValue} and ${event.maxValue} ${event.unitLabel}.`,
    }
  }
  return { ok: true, value }
}

// ── Small shared helpers ──────────────────────────────────────────────────────

/** True when the submission window has closed (deadline passed or status moved on). */
export function isClosedForSubmissions(
  event: { status: string; deadline: Date },
  now: Date = new Date()
): boolean {
  return event.status !== 'OPEN' || now.getTime() >= event.deadline.getTime()
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
