import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { PlusCircle, MessagesSquare } from 'lucide-react'

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
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
            Debates
          </h1>
          <p className="text-[var(--fg-faint)] text-sm mt-1">{debates.length} debate{debates.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link
          href="/editorial/debates/new"
          className="flex items-center gap-2 bg-[#1a2744] text-white text-[12px] font-semibold px-4 py-2.5 rounded-lg hover:bg-[#1a2744]/90 transition-colors"
        >
          <PlusCircle size={14} />
          New Debate
        </Link>
      </div>

      {debates.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <MessagesSquare size={32} className="text-[#ccc]" />
          <p className="text-[15px] font-semibold text-[#1a2744]">No debates yet</p>
          <p className="text-[13px] text-[#888]">Create a debate to engage your readers.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {debates.map((debate, i) => {
            const bd = breakdowns[i]
            return (
              <div
                key={debate.id}
                className="bg-white border border-[#e8e4d9] rounded-lg p-6 hover:bg-[#faf8f4] transition-colors duration-100"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={
                          debate.isActive
                            ? 'text-[10px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-[4px] bg-emerald-50 text-emerald-700'
                            : 'bg-[#f0ede6] text-[#888] text-[10px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-[4px]'
                        }
                      >
                        {debate.isActive ? 'Active' : 'Inactive'}
                      </span>
                      {debate.closesAt && (
                        <span className="text-[11px] text-[#888]">
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
                  <div className="shrink-0 flex gap-3">
                    <Link
                      href={`/editorial/debates/${debate.id}`}
                      className="text-[12px] font-semibold text-[#c9a84c] hover:underline"
                    >
                      Analytics
                    </Link>
                    <Link
                      href={`/editorial/debates/${debate.id}/edit`}
                      className="text-[12px] font-semibold text-[#888] hover:text-[#1a2744] transition-colors"
                    >
                      Edit
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-[#f0f4ff] border border-[#1a2744]/10 rounded-lg p-3">
                    <p className="text-[#1a2744] text-[10px] font-bold uppercase tracking-[0.08em] mb-1">For</p>
                    <p className="text-[#1a2744] text-sm font-semibold line-clamp-1">{debate.forArticle.title}</p>
                  </div>
                  <div className="bg-[#faf5e4] border border-[#c9a84c]/20 rounded-lg p-3">
                    <p className="text-[#8a6a1a] text-[10px] font-bold uppercase tracking-[0.08em] mb-1">Against</p>
                    <p className="text-[#1a2744] text-sm font-semibold line-clamp-1">{debate.againstArticle.title}</p>
                  </div>
                </div>

                {/* Vote bars */}
                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#1a2744] font-bold uppercase tracking-wider">For</span>
                      <span className="text-[#888]">{bd.forCount} ({bd.forPct}%)</span>
                    </div>
                    <div className="h-1.5 bg-[#f0ede6] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700 bg-[#1a2744]" style={{ width: `${bd.forPct}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-[#8a6a1a] font-bold uppercase tracking-wider">Against</span>
                      <span className="text-[#888]">{bd.againstCount} ({bd.againstPct}%)</span>
                    </div>
                    <div className="h-1.5 bg-[#f0ede6] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700 bg-[#c9a84c]" style={{ width: `${bd.againstPct}%` }} />
                    </div>
                  </div>
                </div>

                <p className="text-[#888] text-[11px] mt-3">
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
