import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requirePredictionsAccess } from '@/lib/predictionsAccess'
import { isValidSemesterKey, semesterKeyForDate, semesterLabel } from '@/lib/predictions'
import { displayAuthorName } from '@/lib/authorUtils'

export const metadata: Metadata = {
  title: 'Predictions Leaderboard',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ tab?: string }>
}

interface LeaderboardRow {
  userId: string
  name: string
  eventsPlayed: number
  totalPoints: number
}

async function buildLeaderboard(semesterKey: string | null): Promise<LeaderboardRow[]> {
  // Only scored predictions count. Unresolved events leave points null, so
  // they never reach the table. Late submissions are scored zero, so they
  // count toward events played without adding points.
  const grouped = await prisma.prediction.groupBy({
    by: ['userId'],
    where: {
      points: { not: null },
      event: {
        status: 'RESOLVED',
        ...(semesterKey ? { semesterKey } : {}),
      },
    },
    _sum: { points: true },
    _count: { _all: true },
  })

  if (grouped.length === 0) return []

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, name: true },
  })
  const names = new Map(users.map((u) => [u.id, u.name]))

  return grouped
    .map((g) => ({
      userId: g.userId,
      name: displayAuthorName(names.get(g.userId)) || 'Reader',
      eventsPlayed: g._count._all,
      totalPoints: Math.round(Number(g._sum.points ?? 0) * 100) / 100,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.eventsPlayed - a.eventsPlayed)
}

export default async function PredictionsLeaderboardPage({ searchParams }: Props) {
  const user = await requirePredictionsAccess('/predictions/leaderboard')
  const { tab } = await searchParams

  const currentSemester = semesterKeyForDate(new Date())
  const isAllTime = tab === 'all'
  const semesterKey = !isAllTime && tab && isValidSemesterKey(tab) ? tab : currentSemester

  const rows = await buildLeaderboard(isAllTime ? null : semesterKey)

  // Offer a tab for every semester that has at least one resolved event, so
  // past seasons stay reachable.
  const semesters = await prisma.predictionEvent.findMany({
    where: { status: 'RESOLVED' },
    select: { semesterKey: true },
    distinct: ['semesterKey'],
    orderBy: { semesterKey: 'desc' },
  })
  const semesterTabs = Array.from(
    new Set([currentSemester, ...semesters.map((s) => s.semesterKey)])
  ).sort((a, b) => (a < b ? 1 : -1))

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">Reader League</p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-gold"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Leaderboard
        </h1>
        <Link
          href="/predictions"
          className="inline-block mt-6 text-gold/80 hover:text-gold text-xs tracking-widest uppercase transition-colors"
        >
          ← Back to events
        </Link>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-wrap gap-2 mb-8">
          {semesterTabs.map((key) => (
            <Link
              key={key}
              href={`/predictions/leaderboard?tab=${key}`}
              className={`rounded-full px-4 py-1.5 text-xs tracking-wide border transition-colors ${
                !isAllTime && key === semesterKey
                  ? 'border-gold bg-gold/10 text-gold'
                  : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-gold/50'
              }`}
            >
              {semesterLabel(key)}
            </Link>
          ))}
          <Link
            href="/predictions/leaderboard?tab=all"
            className={`rounded-full px-4 py-1.5 text-xs tracking-wide border transition-colors ${
              isAllTime
                ? 'border-gold bg-gold/10 text-gold'
                : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-gold/50'
            }`}
          >
            All time
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
            No scored events {isAllTime ? 'yet' : 'this semester'}. Rankings appear once the first
            event resolves.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-subtle)] text-left text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
                  <th className="px-4 py-2.5 font-medium">Rank</th>
                  <th className="px-4 py-2.5 font-medium">Reader</th>
                  <th className="px-4 py-2.5 font-medium text-right">Events played</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.userId}
                    className={`border-t border-[var(--border)] ${row.userId === user.id ? 'bg-gold/5' : 'bg-[var(--bg-elevated)]'}`}
                  >
                    <td className="px-4 py-2.5 tabular-nums text-[var(--fg-muted)]">#{i + 1}</td>
                    <td className="px-4 py-2.5 text-[var(--fg)]">
                      {row.name}
                      {row.userId === user.id && <span className="text-gold text-xs ml-2">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[var(--fg-muted)]">
                      {row.eventsPlayed}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gold">
                      {row.totalPoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
