const DEFAULT_API_TIMEOUT_MS = 15_000

export type ApiErrorKind =
  | 'auth'
  | 'permission'
  | 'validation'
  | 'conflict'
  | 'schema'
  | 'server'
  | 'timeout'
  | 'network'
  | 'http'

interface ApiErrorOptions {
  status?: number
  code?: string
  requestId?: string
  cause?: unknown
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly code?: string
  readonly requestId?: string

  constructor(kind: ApiErrorKind, message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
  }
}

export interface ApiRequestOptions {
  /** Override only for unusually fast/slow endpoints. Editorial mutations use 15 seconds. */
  timeoutMs?: number
}

type ErrorBody = {
  error?: unknown
  message?: unknown
  code?: unknown
  requestId?: unknown
  correlationId?: unknown
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    // A successful endpoint may intentionally return plain text. Error pages are
    // not surfaced verbatim because they can contain proxy or infrastructure data.
    return response.ok ? text : null
  }
}

function errorBody(value: unknown): ErrorBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as ErrorBody
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function serverMessage(body: ErrorBody): string | undefined {
  return stringValue(body.error) ?? stringValue(body.message)
}

function isGenericMessage(message: string | undefined): boolean {
  if (!message) return true
  return /^(unauthori[sz]ed|forbidden|internal server error|failed to (create|update|save)\b)/i.test(message)
}

function errorForResponse(response: Response, bodyValue: unknown): ApiError {
  const body = errorBody(bodyValue)
  const suppliedMessage = serverMessage(body)
  const status = response.status
  const requestId =
    stringValue(body.requestId) ??
    stringValue(body.correlationId) ??
    response.headers.get('x-request-id') ??
    response.headers.get('x-correlation-id') ??
    undefined
  const code = stringValue(body.code)
  const options = { status, code, requestId }

  if (status === 401) {
    return new ApiError(
      'auth',
      'Your session has expired. Sign in again, then retry the request.',
      options,
    )
  }
  if (status === 403) {
    return new ApiError(
      'permission',
      isGenericMessage(suppliedMessage)
        ? 'You do not have permission to perform this action.'
        : suppliedMessage!,
      options,
    )
  }
  if (status === 400 || status === 422) {
    return new ApiError(
      'validation',
      suppliedMessage ?? 'Some submitted fields are invalid. Check them and try again.',
      options,
    )
  }
  if (status === 409) {
    return new ApiError(
      'conflict',
      suppliedMessage ?? 'This item changed elsewhere. Refresh it before trying again.',
      options,
    )
  }
  if (status >= 500 && code === 'SCHEMA_MISMATCH') {
    return new ApiError(
      'schema',
      suppliedMessage ?? 'The database schema is out of date. Contact an administrator before retrying.',
      options,
    )
  }
  if (status >= 500) {
    return new ApiError(
      'server',
      isGenericMessage(suppliedMessage)
        ? 'The server could not complete the request because of a server, database, or schema error.'
        : suppliedMessage!,
      options,
    )
  }

  return new ApiError(
    'http',
    suppliedMessage ?? `The request failed (${status}).`,
    options,
  )
}

/**
 * Fetch JSON (or a successful plain-text body) with consistent editorial error
 * semantics. Mutations are attempted exactly once; callers decide if and when a
 * user-triggered retry is safe.
 */
export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false

  const forwardAbort = () => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) forwardAbort()
  else init.signal?.addEventListener('abort', forwardAbort, { once: true })

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const body = await parseBody(response)
    if (!response.ok) throw errorForResponse(response, body)
    return body as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (timedOut) {
      throw new ApiError(
        'timeout',
        `The request timed out after ${Math.round(timeoutMs / 1000)} seconds. Check your connection and try again.`,
        { cause: error },
      )
    }
    throw new ApiError(
      'network',
      'The server could not be reached. Check your connection and try again.',
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', forwardAbort)
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(
    'network',
    'The server could not be reached. Check your connection and try again.',
    { cause: error },
  )
}
