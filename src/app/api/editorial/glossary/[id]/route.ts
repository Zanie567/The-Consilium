import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GLOSSARY_MANAGE_ROLES } from '@/lib/rbac'
import { GLOSSARY_CACHE_TAG } from '@/lib/glossary/data'
import { parseGlossaryTermFields } from '../validate'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/editorial/glossary/[id]
 * Updates a glossary term (including activating or deactivating it).
 * ADMIN only (GLOSSARY_MANAGE_ROLES), re-verified against the database.
 * Body: { term, aliases?, definition, learnMoreUrl?, isActive? }
 */
export async function PATCH(req: Request, context: RouteContext) {
  const caller = await getVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await context.params

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const fields = parseGlossaryTermFields(parsed)
  if ('error' in fields) {
    return NextResponse.json({ error: fields.error }, { status: 400 })
  }
  const data = fields.data

  try {
    const existing = await prisma.glossaryTerm.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Term not found.' }, { status: 404 })
    }

    const clash = await prisma.glossaryTerm.findFirst({
      where: { term: { equals: data.term, mode: 'insensitive' }, id: { not: id } },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: 'A term with that name already exists.' },
        { status: 409 }
      )
    }

    await prisma.glossaryTerm.update({ where: { id }, data })
    revalidateTag(GLOSSARY_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[glossary] PATCH error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/editorial/glossary/[id]
 * Permanently removes a glossary term. Prefer deactivating for terms that
 * might come back. ADMIN only, re-verified against the database.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  const caller = await getVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await context.params

  try {
    const existing = await prisma.glossaryTerm.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Term not found.' }, { status: 404 })
    }
    await prisma.glossaryTerm.delete({ where: { id } })
    revalidateTag(GLOSSARY_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[glossary] DELETE error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
