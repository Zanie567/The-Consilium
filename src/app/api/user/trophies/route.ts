import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response
  const user = auth.user

  try {
    const trophies = await prisma.articleTrophy.findMany({
      where: {
        article: { authorId: user.id, deletedAt: null },
      },
      include: {
        article: { select: { title: true, slug: true } },
      },
      orderBy: { awardedAt: 'desc' },
    })

    return NextResponse.json({ trophies })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
