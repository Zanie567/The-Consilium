import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { format } from 'date-fns'
import { authOptions } from '@/lib/auth'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import {
  getWriterActivity,
  compareByLastPublishedDesc,
  type WriterActivityRow,
} from '@/lib/gamification/writerActivity'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Writer Activity | Editorial',
  robots: { index: false, follow: false },
}

type StatusKind = { label: string; className: string }

function statusFor(row: WriterActivityRow): StatusKind {
  if (row.publishedArticleCount === 0) {
    return { label: 'New', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
  }
  if (row.atRisk) {
    return { label: 'At risk', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
  }
  return { label: 'Active', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }
}

export default async function WriterActivityPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/editorial/login')
  if (session.user.role !== 'ADMIN' && session.user.role !== 'GROWTH') {
    redirect('/editorial')
  }

  const writers = await getWriterActivity()

  // At-risk writers first, then most recently published (never-published last).
  const sorted = [...writers].sort((a, b) => {
    if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1
    return compareByLastPublishedDesc(a, b)
  })

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <PortalSection className="mb-6 sm:mb-8">
        <div className="pl-10 md:pl-0">
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Writer Activity
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            Publishing cadence across writers and editors. At-risk contributors are listed first.
          </p>
        </div>
      </PortalSection>

      <PortalSection>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          {sorted.length === 0 ? (
            <div className="px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
              No writers or editors found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-6 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">
                      Role
                    </th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Published
                    </th>
                    <th className="px-4 py-3 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden md:table-cell">
                      Last Published
                    </th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden lg:table-cell">
                      Streak
                    </th>
                    <th className="px-4 py-3 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {sorted.map((row) => {
                    const status = statusFor(row)
                    return (
                      <tr key={row.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                        <td className="px-6 py-3">
                          <p className="font-medium text-[var(--fg)]">
                            {row.name ?? <span className="italic text-[var(--fg-faint)]">Unnamed</span>}
                          </p>
                          <p className="text-[var(--fg-faint)] text-xs">{row.email}</p>
                        </td>
                        <td className="px-4 py-3 text-[var(--fg-muted)] text-xs hidden sm:table-cell">
                          {row.role}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--fg)] tabular-nums">
                          {row.publishedArticleCount}
                        </td>
                        <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">
                          {row.lastPublishedAt
                            ? `${format(new Date(row.lastPublishedAt), 'd MMM yyyy')}${
                                row.daysSinceLastPublish !== null
                                  ? ` (${row.daysSinceLastPublish}d ago)`
                                  : ''
                              }`
                            : 'Never'}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--fg-muted)] text-xs hidden lg:table-cell tabular-nums">
                          {row.streakData && row.streakData.currentStreak > 0
                            ? `${row.streakData.currentStreak}w`
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-bold px-2 py-0.5 ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PortalSection>
    </PortalPage>
  )
}
