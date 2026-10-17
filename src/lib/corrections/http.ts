import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { apiError, apiServerErrorResponse, transactionFailureResponse } from '@/lib/apiResponse'
import { CorrectionError } from './service'

/** True when PostgreSQL's trigger article_corrections_protect refused a change. */
export function isProtectedRecordViolation(error: unknown, depth = 0): boolean {
  if (!error || depth > 4 || typeof error !== 'object') return false
  const e = error as { message?: unknown; meta?: unknown; cause?: unknown }
  if (typeof e.message === 'string' && e.message.includes('CORRECTION_RECORD_PROTECTED')) return true
  if (e.meta && JSON.stringify(e.meta).includes('CORRECTION_RECORD_PROTECTED')) return true
  return isProtectedRecordViolation(e.cause, depth + 1)
}

/** One error mapping for every corrections route, so the editorial UI sees consistent codes. */
export function correctionErrorResponse(error: unknown, requestId: string, operation: string): NextResponse {
  if (error instanceof CorrectionError) return apiError(error.message, error.status, error.code, requestId)
  if (isProtectedRecordViolation(error)) {
    return apiError('A published correction is permanent and cannot be changed. Publish an amendment instead.', 409, 'CORRECTION_NOT_PENDING', requestId)
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return apiError('The article or correction changed while this was being saved. Nothing was changed. Reload and try again.', 409, 'ARTICLE_CHANGED', requestId)
  }
  const concurrency = transactionFailureResponse(error, requestId)
  if (concurrency) return concurrency
  return apiServerErrorResponse(error, {
    operation,
    userMessage: 'The correction could not be saved because of a server error. Nothing was changed; your text is still in the form.',
    code: 'CORRECTION_FAILED',
    requestId,
  })
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
