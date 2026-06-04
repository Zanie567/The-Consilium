import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props { params: Promise<{ articleId: string }> }

// GET - fetch saved progress for a specific article
export async function GET(_req: Request, { params }: Props) {
  const user = await getVerifiedSessionUser()
  if (!user) return NextResponse.json(null)

  const { articleId } = await params

  // Distinguish a DB failure (500) from a genuine absent record (null/200)
  // so callers don't treat a database outage as "no progress recorded yet".
  try {
    const row = await prisma.readingProgress.findUnique({
      where: { userId_articleId: { userId: user.id, articleId } },
      select: { progress: true, scrollY: true },
    })
    // null means no record - that is a valid, expected state
    return NextResponse.json(row)
  } catch (err) {
    console.error('[reading-progress/[articleId]/GET]', err)
    return NextResponse.json({ error: 'Failed to fetch reading progress.' }, { status: 500 })
  }
}
