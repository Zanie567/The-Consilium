import { NextResponse } from 'next/server'
import { apiError } from '@/lib/apiResponse'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { tagErrorBody } from '@/lib/tags/manage'

/** The JSON body as an object, or null when it is not one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const invalidBody = () => apiError('The request was not understood.', 400, 'INVALID_BODY')

/** A refused tag action becomes its own message and status; anything else is logged and a 500. */
export function tagRouteError(error: unknown, context: string): NextResponse {
  const known = tagErrorBody(error)
  if (known) return NextResponse.json(known.body, { status: known.status })
  console.error(`[api/editorial/tags:${context}]`, error)
  return apiError('The tag change could not be saved. Please try again.', 500, 'TAG_SAVE_FAILED')
}

/**
 * Public pages show tag names and tag pages redirect merged tags, so changes that touch them expire
 * the public caches (the same call a publish makes). Never throws.
 */
export async function refreshPublicTagPages(): Promise<void> {
  await revalidateArticleLists()
}
