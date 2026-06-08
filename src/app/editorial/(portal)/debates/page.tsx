import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { PlusCircle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Debates | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

async function getDebates() {
  return prisma.debate.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      forArticle: { select: { title: true, slug: true } },
      againstArticle: { select: { title: true, slug: true } },
      _count: { select: { votes: true } },
    },
  })
}

async function getVoteBreakdown(debateId: string) {
  const counts = await prisma.debateVote.groupBy({
    by: ['side'],
    where: { debateId },
    _count: { side: true },
  })
  const forCount = counts.find((c) => c.side === 'FOR')?._count.side ?? 0
  const againstCount = counts.find((c) => c.side === 'AGAINST')?._count.side ?? 0
  const total = forCount + againstCount
  return {
    forCount,
    againstCount,
    forPct: total > 0 ? Math.round((forCount / total) * 100) : 0,
    againstPct: total > 0 ? Math.round((againstCount / total) * 100) : 0,
  }
}

export default async function DebatesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['ADMIN', 'EDITOR'].includes(session.user.role ?? '')) {
    redirect('/editorial/login')
  }

  const debates = await getDebates()
  const breakdowns = await Promise.all(debates.map((d) => getVoteBreakdown(d.id)))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 sm:mb-8 pl-10 md:pl-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Debates
          </h1>
          <p className="text-[var(--fg-faint)] text-sm mt-1">{debates.length} debate{debates.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link
          href="/editorial/debates/new"
          className="flex items-center gap-2 bg-navy text-cream text-xs font-bold uppercase tracking-widest px-3 sm:px-5 py-2.5 hover:bg-navy/90 transition-colors min-h-[44px]"
        >
          <PlusCircle size={14} />
          <span className="hidden sm:inline">New Debate</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {debates.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[var(--border)]">
          <p className="text-[var(--fg-faint)] text-sm">No debates yet.</p>
          <Link href="/editorial/debates/new" className="mt-4 inline-block text-gold text-xs font-bold hover:underline">
            Create your first debate →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {debates.map((debate, i) => {
            const bd = breakdowns[i]
            return (
              <div
                key={debate.id}
                className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] p-6"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[0.6rem] font-bold uppercase tracking-[0.2em] px-2 py-0.5 ${
                          debate.isActive
                            ? 'bg-green-500/15 text-green-600'
                            : 'bg-[var(--border)] text-[var(--fg-faint)]'
                        }`}
                      >
                        {debate.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {debate.closesAt && (
                        <span className="text-[0.6rem] text-[var(--fg-faint)] uppercase tracking-widest">
                          Closes {format(new Date(debate.closesAt), 'd MMM yyyy')}
                        </span>
                      )}
                    </div>
                    <h2
                      className="font-bold text-[var(--fg)] text-base leading-snug"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {debate.title}
                    </h2>
                    {debate.description && (
                      <p className="text-[var(--fg-muted)] text-sm mt-1">{debate.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <Link
                      href={`/editorial/debates/${debate.id}`}
                      className="text-xs font-semibold text-gold hover:underline"
                    >
                      Analytics
                    </Link>
                    <Link
                      href={`/editorial/debates/${debate.id}/edit`}
                      className="text-xs font-semibold text-[var(--fg-muted)] hover:text-[var(--fg)]"
                    >
                      Edit
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-navy/5 border border-navy/20 p-3">
                    <p className="text-navy text-[0.6rem] font-bold uppercase tracking-widest mb-1">For</p>
                    <p className="text-[var(--fg)] text-sm font-semibold line-clamp-1">{debate.forArticle.title}</p>
                  </div>
                  <div className="bg-gold/5 border border-gold/20 p-3">
                    <p className="text-gold text-[0.6rem] font-bold uppercase tracking-widest mb-1">Against</p>
                    <p className="text-[var(--fg)] text-sm font-semibold line-clamp-1">{debate.againstArticle.title}</p>
                  </div>
                </div>

                {/* Vote bars */}
                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-navy font-bold uppercase tracking-wider">For</span>
                      <span className="text-[var(--fg-faint)]">{bd.forCount} ({bd.forPct}%)</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-subtle)]">
                      <div className="h-full bg-navy transition-all" style={{ width: `${bd.forPct}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-gold font-bold uppercase tracking-wider">Against</span>
                      <span className="text-[var(--fg-faint)]">{bd.againstCount} ({bd.againstPct}%)</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-subtle)]">
                      <div className="h-full bg-gold transition-all" style={{ width: `${bd.againstPct}%` }} />
                    </div>
                  </div>
                </div>

                <p className="text-[var(--fg-faint)] text-[10px] mt-2">
                  {debate._count.votes.toLocaleString()} total vote{debate._count.votes !== 1 ? 's' : ''}
                  {' · '}Created {format(new Date(debate.createdAt), 'd MMM yyyy')}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
