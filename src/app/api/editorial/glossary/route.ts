import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GLOSSARY_MANAGE_ROLES } from '@/lib/rbac'
import { GLOSSARY_CACHE_TAG } from '@/lib/glossary/data'
import { parseGlossaryTermFields } from './validate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/editorial/glossary
 * Creates a glossary term. ADMIN only (GLOSSARY_MANAGE_ROLES); the role is
 * re-verified against the database on every call.
 * Body: { term, aliases?, definition, learnMoreUrl?, isActive? }
 */
export async function POST(req: Request) {
  const caller = await getVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    // Case-insensitive uniqueness, also enforced by the lower(term) unique
    // index in Supabase; this check exists to return a friendly message.
    const existing = await prisma.glossaryTerm.findFirst({
      where: { term: { equals: data.term, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A term with that name already exists.' },
        { status: 409 }
      )
    }

    const created = await prisma.glossaryTerm.create({
      data,
      select: { id: true },
    })
    revalidateTag(GLOSSARY_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ ok: true, id: created.id })
  } catch (err) {
    // Two concurrent creates can both pass the check above; the unique index
    // on term / lower(term) rejects the loser with P2002.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'A term with that name already exists.' },
        { status: 409 }
      )
    }
    console.error('[glossary] POST error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
