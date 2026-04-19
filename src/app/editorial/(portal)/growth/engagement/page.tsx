import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Engagement | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function EngagementPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (!['ADMIN', 'GROWTH'].includes(session.user.role ?? '')) redirect('/editorial')

  const [topArticles, debates, topCommenters] = await Promise.all([
    // Section 1 – top articles by view count
    prisma.article.findMany({
      where: { status: 'PUBLISHED', deletedAt: null },
      orderBy: { viewCount: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        slug: true,
        viewCount: true,
        category: { select: { name: true } },
      },
    }),

    // Section 2 – all debates with vote breakdown
    prisma.debate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        forArticle: { select: { title: true, slug: true } },
        againstArticle: { select: { title: true, slug: true } },
        _count: { select: { votes: true } },
      },
    }),

    // Section 3 – top commenters
    prisma.comment.groupBy({
      by: ['userId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
      where: { userId: { not: undefined }, isHidden: false },
    }),
  ]).catch(() => [[], [], []] as const)

  // Fetch vote breakdown per debate
  const debateVotes = await Promise.all(
    (debates as Awaited<typeof debates>).map(async (d) => {
      const counts = await prisma.debateVote.groupBy({
        by: ['side'],
        where: { debateId: d.id },
        _count: { side: true },
      })
      const forCount = counts.find((c) => c.side === 'FOR')?._count.side ?? 0
      const againstCount = counts.find((c) => c.side === 'AGAINST')?._count.side ?? 0
      return { debateId: d.id, forCount, againstCount }
    })
  ).catch(() => [])

  // Resolve commenter user names
  const commenterUserIds = (topCommenters as { userId: string | null; _count: { id: number } }[])
    .filter((c) => c.userId !== null)
    .map((c) => c.userId as string)

  const commenterUsers = await prisma.user.findMany({
    where: { id: { in: commenterUserIds } },
    select: { id: true, name: true, email: true },
  }).catch(() => [])

  const maxViews = (topArticles as { viewCount: number }[])[0]?.viewCount ?? 1

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <PortalSection className="mb-8">
        <div className="pl-10 md:pl-0">
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Engagement
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            Most-read articles, debate participation, and community activity.
          </p>
        </div>
      </PortalSection>

      {/* ── Section 1: Most-read articles ──────────────────────────────────── */}
      <PortalSection className="mb-10">
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-4">
          Most-read Articles
        </h2>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          {(topArticles as { id: string; title: string; slug: string; viewCount: number; category: { name: string } | null }[]).length === 0 ? (
            <p className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">No data yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(topArticles as { id: string; title: string; slug: string; viewCount: number; category: { name: string } | null }[]).map((article, i) => {
                const pct = Math.round((article.viewCount / maxViews) * 100)
                return (
                  <div key={article.id} className="flex items-center gap-4 px-6 py-4">
                    <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/articles/${article.slug}`}
                        className="font-medium text-[var(--fg)] hover:text-gold transition-colors text-sm line-clamp-1"
                        target="_blank"
                      >
                        {article.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 max-w-[200px] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gold/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--fg-faint)] tabular-nums shrink-0">
                          {article.viewCount.toLocaleString()} views
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[var(--fg-faint)] shrink-0 hidden sm:block">
                      {article.category?.name ?? 'Uncategorised'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PortalSection>

      {/* ── Section 2: Debate engagement ───────────────────────────────────── */}
      <PortalSection className="mb-10">
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-4">
          Debate Engagement
        </h2>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          {(debates as Awaited<typeof debates>).length === 0 ? (
            <p className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">No debates yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(debates as Awaited<typeof debates>).map((debate) => {
                const votes = debateVotes.find((v) => v.debateId === debate.id)
                const forCount = votes?.forCount ?? 0
                const againstCount = votes?.againstCount ?? 0
                const total = forCount + againstCount
                const forPct = total > 0 ? Math.round((forCount / total) * 100) : 50
                const leadingSide = forCount > againstCount ? 'FOR' : againstCount > forCount ? 'AGAINST' : 'TIE'

                return (
                  <div key={debate.id} className="px-6 py-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <p className="font-semibold text-[var(--fg)] text-sm line-clamp-2 flex-1">
                        {debate.title}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 shrink-0 ${
                        leadingSide === 'FOR'
                          ? 'bg-navy/20 text-blue-600 dark:text-blue-400'
                          : leadingSide === 'AGAINST'
                          ? 'bg-gold/20 text-gold'
                          : 'bg-[var(--border)] text-[var(--fg-faint)]'
                      }`}>
                        {leadingSide === 'TIE' ? 'Tied' : `${leadingSide} leading`}
                      </span>
                    </div>

                    {/* Vote bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-blue-500 dark:text-blue-400 font-semibold w-8 text-right tabular-nums shrink-0">
                        {forPct}%
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden flex">
                        <div
                          className="h-full bg-blue-500/60 transition-all"
                          style={{ width: `${forPct}%` }}
                        />
                        <div className="h-full flex-1 bg-gold/50" />
                      </div>
                      <span className="text-[10px] text-gold font-semibold w-8 tabular-nums shrink-0">
                        {100 - forPct}%
                      </span>
                    </div>

                    <div className="flex justify-between text-[10px] text-[var(--fg-faint)]">
                      <span>FOR: {forCount.toLocaleString()} votes</span>
                      <span className="text-[var(--fg-faint)]">
                        {total.toLocaleString()} total
                      </span>
                      <span>AGAINST: {againstCount.toLocaleString()} votes</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PortalSection>

      {/* ── Section 3: Top commenters ──────────────────────────────────────── */}
      <PortalSection>
        <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest mb-4">
          Top Commenters
        </h2>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          {(topCommenters as { userId: string | null; _count: { id: number } }[]).length === 0 ? (
            <p className="px-6 py-10 text-center text-[var(--fg-faint)] text-sm">No comment data yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(topCommenters as { userId: string | null; _count: { id: number } }[]).map((row, i) => {
                const user = commenterUsers.find((u) => u.id === row.userId)
                return (
                  <div key={row.userId ?? i} className="flex items-center gap-4 px-6 py-3">
                    <span className="text-[var(--fg-faint)] text-xs font-bold w-5 shrink-0 tabular-nums">
                      {i + 1}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-gold/15 flex items-center justify-center shrink-0">
                      <span className="text-gold text-[11px] font-bold">
                        {(user?.name ?? user?.email ?? '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <p className="flex-1 text-sm font-medium text-[var(--fg)] truncate">
                      {user?.name ?? user?.email ?? 'Unknown'}
                    </p>
                    <span className="text-xs font-bold text-[var(--fg)] tabular-nums">
                      {row._count.id.toLocaleString()}
                      <span className="text-[var(--fg-faint)] font-normal ml-1">comments</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PortalSection>
    </PortalPage>
  )
}
