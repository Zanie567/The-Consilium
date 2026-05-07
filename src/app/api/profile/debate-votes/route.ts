import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/profile/debate-votes - user's debate votes with results
export async function GET() {
  const session = await getServerSession(authOptions)
  const authError = requireActiveSession(session)
  if (authError) return authError

  try {
    const votes = await prisma.debateVote.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        debate: {
          select: {
            id: true,
            title: true,
            description: true,
            isActive: true,
            closesAt: true,
            forArticle: { select: { id: true, title: true, slug: true } },
            againstArticle: { select: { id: true, title: true, slug: true } },
            _count: { select: { votes: true } },
          },
        },
      },
    })

    // Fetch vote breakdown for each debate
    const withBreakdown = await Promise.all(
      votes.map(async (vote) => {
        const counts = await prisma.debateVote.groupBy({
          by: ['side'],
          where: { debateId: vote.debateId },
          _count: { side: true },
        })
        const forCount = counts.find((c) => c.side === 'FOR')?._count.side ?? 0
        const againstCount = counts.find((c) => c.side === 'AGAINST')?._count.side ?? 0
        const total = forCount + againstCount
        return {
          ...vote,
          forCount,
          againstCount,
          forPct: total > 0 ? Math.round((forCount / total) * 100) : 0,
          againstPct: total > 0 ? Math.round((againstCount / total) * 100) : 0,
        }
      })
    )

    return NextResponse.json(withBreakdown)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch debate votes' }, { status: 500 })
  }
}
