import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const debate = await prisma.debate.findFirst({
    where: { isActive: true },
    include: {
      forArticle: {
        select: {
          id: true, title: true, slug: true, excerpt: true, content: true,
          author: { select: { name: true } },
        },
      },
      againstArticle: {
        select: {
          id: true, title: true, slug: true, excerpt: true, content: true,
          author: { select: { name: true } },
        },
      },
      _count: { select: { votes: true } },
    },
  })

  if (!debate) return NextResponse.json(null)

  // Determine if viewer has voted
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const anonymousId = cookieStore.get('consilium_anon_id')?.value

  let existingVote: { side: string } | null = null

  if (session?.user?.id) {
    existingVote = await prisma.debateVote.findUnique({
      where: { debateId_userId: { debateId: debate.id, userId: session.user.id } },
      select: { side: true },
    })
  } else if (anonymousId) {
    existingVote = await prisma.debateVote.findFirst({
      where: { debateId: debate.id, anonymousId },
      select: { side: true },
    })
  }

  // Only include vote breakdown if the viewer has already voted (or debate is closed)
  const isClosed = debate.closesAt ? new Date() > debate.closesAt : false
  const hasVoted = existingVote !== null || isClosed

  let forCount = 0
  let againstCount = 0
  let forPct = 0
  let againstPct = 0

  if (hasVoted) {
    const counts = await prisma.debateVote.groupBy({
      by: ['side'],
      where: { debateId: debate.id },
      _count: { side: true },
    })
    forCount = counts.find((c) => c.side === 'FOR')?._count.side ?? 0
    againstCount = counts.find((c) => c.side === 'AGAINST')?._count.side ?? 0
    const total = forCount + againstCount
    forPct = total > 0 ? Math.round((forCount / total) * 100) : 0
    againstPct = total > 0 ? 100 - forPct : 0
  }

  // Estimate read time from content length
  function readTime(content: string): string {
    try {
      const text = JSON.stringify(JSON.parse(content))
      const words = text.split(/\s+/).length
      return `${Math.max(1, Math.round(words / 200))} min read`
    } catch {
      const words = content.split(/\s+/).length
      return `${Math.max(1, Math.round(words / 200))} min read`
    }
  }

  return NextResponse.json({
    id: debate.id,
    title: debate.title,
    description: debate.description,
    isActive: debate.isActive,
    closesAt: debate.closesAt,
    isClosed,
    forArticle: {
      id: debate.forArticle.id,
      title: debate.forArticle.title,
      slug: debate.forArticle.slug,
      excerpt: debate.forArticle.excerpt,
      author: debate.forArticle.author.name,
      readTime: readTime(debate.forArticle.content),
    },
    againstArticle: {
      id: debate.againstArticle.id,
      title: debate.againstArticle.title,
      slug: debate.againstArticle.slug,
      excerpt: debate.againstArticle.excerpt,
      author: debate.againstArticle.author.name,
      readTime: readTime(debate.againstArticle.content),
    },
    hasVoted,
    userSide: existingVote?.side ?? null,
    totalVotes: debate._count.votes,
    ...(hasVoted && {
      forCount,
      againstCount,
      forPct,
      againstPct,
    }),
  })
}
