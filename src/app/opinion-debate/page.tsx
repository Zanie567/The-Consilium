import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { DebatePanel, type DebateData } from '@/components/ui/DebatePanel'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Opinion Debate | The Consilium',
  description: 'Read both sides of the argument, then cast your vote. The Consilium opinion debate series.',
  openGraph: {
    title: 'Opinion Debate | The Consilium',
    description: 'Read both sides of the argument, then cast your vote.',
  },
}

function estimateReadTime(content: string): string {
  try {
    const words = JSON.stringify(JSON.parse(content)).split(/\s+/).length
    return `${Math.max(1, Math.round(words / 200))} min read`
  } catch {
    return `${Math.max(1, Math.round(content.split(/\s+/).length / 200))} min read`
  }
}

async function getDebates(userId?: string, anonymousId?: string): Promise<DebateData[]> {
  try {
    const debates = await prisma.debate.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: {
        forArticle: {
          select: { id: true, title: true, slug: true, excerpt: true, content: true, author: { select: { name: true } } },
        },
        againstArticle: {
          select: { id: true, title: true, slug: true, excerpt: true, content: true, author: { select: { name: true } } },
        },
        _count: { select: { votes: true } },
      },
    })

    return Promise.all(
      debates.map(async (debate) => {
        const isClosed = debate.closesAt ? new Date() > debate.closesAt : !debate.isActive

        let existingVote: { side: string } | null = null
        if (userId) {
          existingVote = await prisma.debateVote.findFirst({
            where: { debateId: debate.id, userId },
            select: { side: true },
          })
        } else if (anonymousId) {
          existingVote = await prisma.debateVote.findFirst({
            where: { debateId: debate.id, anonymousId },
            select: { side: true },
          })
        }

        const hasVoted = existingVote !== null || isClosed
        let forCount = 0, againstCount = 0, forPct = 0, againstPct = 0

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

        return {
          id: debate.id,
          title: debate.title,
          description: debate.description,
          isClosed,
          closesAt: debate.closesAt?.toISOString() ?? null,
          forArticle: {
            id: debate.forArticle.id,
            title: debate.forArticle.title,
            slug: debate.forArticle.slug,
            excerpt: debate.forArticle.excerpt,
            author: debate.forArticle.author.name,
            readTime: estimateReadTime(debate.forArticle.content),
          },
          againstArticle: {
            id: debate.againstArticle.id,
            title: debate.againstArticle.title,
            slug: debate.againstArticle.slug,
            excerpt: debate.againstArticle.excerpt,
            author: debate.againstArticle.author.name,
            readTime: estimateReadTime(debate.againstArticle.content),
          },
          hasVoted,
          userSide: (existingVote?.side as 'FOR' | 'AGAINST') ?? null,
          totalVotes: debate._count.votes,
          ...(hasVoted && { forCount, againstCount, forPct, againstPct }),
        } satisfies DebateData
      })
    )
  } catch {
    return []
  }
}

export default async function OpinionDebatePage() {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const anonymousId = cookieStore.get('consilium_anon_id')?.value
  const debates = await getDebates(session?.user?.id, anonymousId)

  const active = debates.filter((d) => !d.isClosed)
  const past   = debates.filter((d) => d.isClosed)

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Hero */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, #c9a227 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <AnimateIn variant="fade-in" duration={0.4}>
            <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-3 font-semibold">
              The Consilium
            </p>
          </AnimateIn>
          <AnimateIn variant="fade-up" delay={0.08} duration={0.6}>
            <h1
              className="text-4xl sm:text-5xl font-bold text-gold mb-4"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Opinion Debate
            </h1>
          </AnimateIn>
          <AnimateIn variant="fade-in" delay={0.18} duration={0.55}>
            <div className="w-16 h-px bg-gradient-to-r from-transparent via-gold to-transparent mx-auto mb-4 opacity-60" />
            <p className="text-cream/60 text-sm max-w-lg mx-auto leading-relaxed">
              Two writers. One question. Read both sides of the argument — then cast your vote.
              Results are hidden until after you vote.
            </p>
          </AnimateIn>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {/* Active debates */}
        {active.length > 0 && (
          <section className="mb-16">
            <AnimateIn variant="fade-up">
              <div className="flex items-center gap-3 mb-8">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-gold/60 text-[0.65rem] font-bold tracking-[0.3em] uppercase">
                    Live Now
                  </span>
                </span>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>
            </AnimateIn>
            {active.map((debate) => (
              <AnimateIn key={debate.id} variant="fade-up" delay={0.05}>
                <DebatePanel initialData={debate} />
              </AnimateIn>
            ))}
          </section>
        )}

        {/* Past debates */}
        {past.length > 0 && (
          <section>
            <AnimateIn variant="fade-up">
              <div className="flex items-center gap-3 mb-8">
                <span className="text-gold/50 text-[0.65rem] font-bold tracking-[0.3em] uppercase">
                  Past Debates
                </span>
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[var(--fg-faint)] text-[0.65rem] uppercase tracking-widest">
                  Results Shown
                </span>
              </div>
            </AnimateIn>
            <div className="space-y-10">
              {past.map((debate, i) => (
                <AnimateIn key={debate.id} variant="fade-up" delay={i * 0.05}>
                  <DebatePanel initialData={debate} />
                </AnimateIn>
              ))}
            </div>
          </section>
        )}

        {debates.length === 0 && (
          <AnimateIn variant="fade-up">
            <div className="py-24 text-center border border-dashed border-[var(--border)]">
              <p
                className="text-3xl font-bold text-[var(--fg-faint)] mb-3"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                No debates yet
              </p>
              <p className="text-[var(--fg-faint)] text-sm">Check back soon for our first debate.</p>
            </div>
          </AnimateIn>
        )}
      </div>
    </div>
  )
}
