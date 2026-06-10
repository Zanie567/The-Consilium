/**
 * Field parsing and validation shared by the create and update prediction
 * event endpoints. Kept out of the route files so both can use it without
 * duplicating the rules.
 */

const EVENT_TYPES = ['BOE_RATE', 'CPI_YOY', 'OTHER'] as const
export type PredictionEventTypeValue = (typeof EVENT_TYPES)[number]

export interface ParsedEventFields {
  title?: string
  description?: string | null
  type?: PredictionEventTypeValue
  fredSeriesId?: string | null
  unitLabel?: string
  deadline?: Date
  releaseDate?: Date
  minValue?: number
  maxValue?: number
  maxError?: number
}

type ParseResult = { data: ParsedEventFields } | { error: string }

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseNumber(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (typeof raw === 'string' && raw.trim() === '') return null
  return Number.isFinite(n) ? n : null
}

/**
 * Parses event fields from an untrusted body. With requireAll, every field a
 * new event needs must be present (create). Without it, only the supplied
 * fields are validated and returned (partial update).
 */
export function parseEventFields(
  parsed: unknown,
  { requireAll }: { requireAll: boolean }
): ParseResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'Invalid request body.' }
  }
  const body = parsed as Record<string, unknown>
  const data: ParsedEventFields = {}

  if (body.title !== undefined || requireAll) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return { error: 'Title is required.' }
    }
    if (body.title.trim().length > 200) {
      return { error: 'Title must be 200 characters or fewer.' }
    }
    data.title = body.title.trim()
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { error: 'Description must be text.' }
    }
    const trimmed = typeof body.description === 'string' ? body.description.trim() : ''
    data.description = trimmed === '' ? null : trimmed
  }

  if (body.type !== undefined || requireAll) {
    if (!EVENT_TYPES.includes(body.type as PredictionEventTypeValue)) {
      return { error: 'Type must be BOE_RATE, CPI_YOY, or OTHER.' }
    }
    data.type = body.type as PredictionEventTypeValue
  }

  if (body.fredSeriesId !== undefined) {
    if (body.fredSeriesId !== null && typeof body.fredSeriesId !== 'string') {
      return { error: 'FRED series id must be text.' }
    }
    const trimmed = typeof body.fredSeriesId === 'string' ? body.fredSeriesId.trim() : ''
    if (trimmed !== '' && !/^[A-Za-z0-9_]{1,40}$/.test(trimmed)) {
      return { error: 'FRED series id may only contain letters, numbers, and underscores.' }
    }
    data.fredSeriesId = trimmed === '' ? null : trimmed
  }

  if (body.unitLabel !== undefined || requireAll) {
    if (typeof body.unitLabel !== 'string' || body.unitLabel.trim() === '') {
      return { error: 'Unit label is required, for example "%" or "% y/y".' }
    }
    if (body.unitLabel.trim().length > 20) {
      return { error: 'Unit label must be 20 characters or fewer.' }
    }
    data.unitLabel = body.unitLabel.trim()
  }

  if (body.deadline !== undefined || requireAll) {
    const d = parseDate(body.deadline)
    if (!d) return { error: 'Deadline must be a valid date and time.' }
    data.deadline = d
  }

  if (body.releaseDate !== undefined || requireAll) {
    const d = parseDate(body.releaseDate)
    if (!d) return { error: 'Expected release date must be a valid date and time.' }
    data.releaseDate = d
  }

  if (body.minValue !== undefined || requireAll) {
    const n = parseNumber(body.minValue)
    if (n === null) return { error: 'Minimum value must be a number.' }
    data.minValue = n
  }

  if (body.maxValue !== undefined || requireAll) {
    const n = parseNumber(body.maxValue)
    if (n === null) return { error: 'Maximum value must be a number.' }
    data.maxValue = n
  }

  if (body.maxError !== undefined && body.maxError !== null && body.maxError !== '') {
    const n = parseNumber(body.maxError)
    if (n === null || n <= 0) {
      return { error: 'Maximum error must be a number greater than zero.' }
    }
    data.maxError = n
  }

  // Cross-field rules, checked only when both sides are present in this parse.
  // Partial updates that touch one side are re-checked against the stored row
  // by the update endpoint.
  if (data.minValue !== undefined && data.maxValue !== undefined && data.minValue >= data.maxValue) {
    return { error: 'Minimum value must be below maximum value.' }
  }
  if (data.deadline && data.releaseDate && data.deadline.getTime() > data.releaseDate.getTime()) {
    return { error: 'The deadline must be on or before the expected release date.' }
  }

  return { data }
}
