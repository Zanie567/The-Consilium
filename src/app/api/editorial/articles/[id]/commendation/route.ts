import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

interface Props {
  params: Promise<{ id: string }>
}

const MAX_LENGTH = 200

/**
 * PATCH /api/editorial/articles/[id]/commendation
 *
 * Sets or clears an article's editorial commendation. EDITOR or ADMIN only.
 * Body: { commendation: string | null }. A string is trimmed and must be at
 * most 200 characters; null or an empty string clears the commendation.
 */
export async function PATCH(req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  let commendation: string | null
  try {
    const body = (await req.json()) as { commendation: unknown }
    const raw = body.commendation
    if (raw === null) {
      commendation = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > MAX_LENGTH) {
        return NextResponse.json(
          { error: `Commendation must be ${MAX_LENGTH} characters or fewer.` },
          { status: 400 }
        )
      }
      commendation = trimmed.length === 0 ? null : trimmed
    } else {
      return NextResponse.json({ error: 'commendation must be a string or null' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const article = await prisma.article.findUnique({ where: { id }, select: { id: true } })
    if (!article) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updated = await prisma.article.update({
      where: { id },
      data: { editorialCommendation: commendation },
      select: { id: true, editorialCommendation: true },
    })

    return NextResponse.json({
      id: updated.id,
      editorialCommendation: updated.editorialCommendation,
    })
  } catch (err) {
    console.error('[editorial/commendation] Error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
