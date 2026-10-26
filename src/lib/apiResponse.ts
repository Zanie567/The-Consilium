import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { transactionFailure } from '@/lib/transactionRetry'
import { slugGuardViolation } from '@/lib/articleSlug'

export interface ApiErrorBody {
  error: string
  code: string
  requestId?: string
}

export function apiError(
  error: string,
  status: number,
  code: string,
  requestId?: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error, code, ...(requestId ? { requestId } : {}) },
    { status, headers: requestId ? { 'x-request-id': requestId } : undefined }
  )
}

const DATABASE_UNAVAILABLE_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
])

export function isPrismaSchemaMismatch(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2021' || error.code === 'P2022')
  )
}

/**
 * A transaction PostgreSQL aborted because of concurrent work (see transactionRetry.ts). In both cases nothing
 * was committed, so the user can safely repeat the action. Null for every other error.
 *   conflict (still failing after the bounded retry) -> 409 CONCURRENT_UPDATE
 *   busy (a lock or transaction timeout)             -> 503 DATABASE_BUSY, Retry-After: 2
 */
export function transactionFailureResponse(
  error: unknown,
  requestId?: string
): NextResponse<ApiErrorBody> | null {
  const failure = transactionFailure(error)
  if (failure === 'conflict') {
    return apiError(
      'Another change to the same content was being saved at the same moment, so nothing was changed. Try again.',
      409,
      'CONCURRENT_UPDATE',
      requestId
    )
  }
  if (failure === 'busy') {
    const response = apiError(
      'The database was busy with another change, so nothing was changed. Try again in a moment.',
      503,
      'DATABASE_BUSY',
      requestId
    )
    response.headers.set('Retry-After', '2')
    return response
  }
  return null
}

interface ApiServerErrorOptions {
  operation: string
  userMessage: string
  code: string
  status?: number
  requestId?: string
}

/**
 * Convert unexpected server/Prisma failures into a safe response that clients
 * can classify. Full error details stay in server logs and the request ID lets
 * an operator correlate the user-visible failure without leaking SQL/schema
 * internals to the browser.
 */
export function apiServerErrorResponse(
  error: unknown,
  options: ApiServerErrorOptions
): NextResponse<ApiErrorBody> {
  const requestId = options.requestId ?? crypto.randomUUID()
  console.error(`[${options.operation}]`, { requestId, error })

  const concurrency = transactionFailureResponse(error, requestId)
  if (concurrency) return concurrency

  if (isPrismaSchemaMismatch(error)) {
    return apiError(
      'The database schema is out of date. Contact an administrator before retrying.',
      503,
      'SCHEMA_MISMATCH',
      requestId
    )
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      DATABASE_UNAVAILABLE_CODES.has(error.code))
  ) {
    return apiError(
      'The database is temporarily unavailable. Try again in a moment.',
      503,
      'DATABASE_UNAVAILABLE',
      requestId
    )
  }

  return apiError(
    options.userMessage,
    options.status ?? 500,
    options.code,
    requestId
  )
}

export function articleMutationErrorResponse(
  error: unknown,
  operation: 'create' | 'update' | 'delete',
  requestId: string
): NextResponse<ApiErrorBody> {
  console.error(`[api/articles:${operation}]`, { requestId, error })

  if (error instanceof SyntaxError) {
    return apiError('The request body is not valid JSON.', 400, 'INVALID_JSON', requestId)
  }

  const concurrency = transactionFailureResponse(error, requestId)
  if (concurrency) return concurrency

  // Refusals from the database trigger articles_slug_guard (migration 20261024120000).
  const slugViolation = slugGuardViolation(error)
  if (slugViolation === 'locked') {
    return apiError(
      'The web address of a published article cannot be changed: existing links would break.',
      409,
      'PUBLISHED_SLUG_LOCKED',
      requestId
    )
  }
  if (slugViolation === 'retired') {
    return apiError(
      'That web address used to belong to another article and now redirects to it. Choose a different one.',
      409,
      'SLUG_CONFLICT',
      requestId
    )
  }

  // Matches apiServerErrorResponse: a connection failure is retryable and must
  // not be reported as a generic article-save error.
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return apiError(
      'The database is temporarily unavailable. Try again in a moment.',
      503,
      'DATABASE_UNAVAILABLE',
      requestId
    )
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025' && (operation === 'update' || operation === 'delete')) {
      return apiError(
        operation === 'delete'
          ? 'This article changed before it could be moved to trash. Reload before trying again.'
          : 'This article changed while saving. Reload it before retrying; your unsaved changes remain in this tab.',
        409,
        'ARTICLE_CHANGED',
        requestId
      )
    }
    if (error.code === 'P2002') {
      return apiError(
        'An article with this slug already exists. Choose a different slug.',
        409,
        'SLUG_CONFLICT',
        requestId
      )
    }
    if (error.code === 'P2003') {
      return apiError(
        'The selected author, category, series, or tag no longer exists.',
        400,
        'INVALID_RELATION',
        requestId
      )
    }
    if (isPrismaSchemaMismatch(error)) {
      return apiError(
        'The database schema is out of date. Contact an administrator before retrying.',
        503,
        'SCHEMA_MISMATCH',
        requestId
      )
    }
    if (DATABASE_UNAVAILABLE_CODES.has(error.code)) {
      return apiError(
        'The database is temporarily unavailable. Try again in a moment.',
        503,
        'DATABASE_UNAVAILABLE',
        requestId
      )
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return apiError(
      'The article data is invalid. Review the fields and try again.',
      400,
      'VALIDATION_ERROR',
      requestId
    )
  }

  const action = operation === 'delete' ? 'deleted' : 'saved'
  return apiError(
    `The article could not be ${action} because of a server error.`,
    500,
    'ARTICLE_MUTATION_FAILED',
    requestId
  )
}
