import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { ADMIN_ONLY } from '@/lib/rbac'

export const metadata: Metadata = { title: 'Login Attempts' }

export default async function LoginAttemptsPage() {
  const user = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!user) redirect('/editorial')

  const attempts = await prisma.loginAttempt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const failCount = attempts.filter((a) => !a.success).length
  const successCount = attempts.filter((a) => a.success).length

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-8 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
          Login Attempts
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mt-1">Last 200 login attempts across all accounts</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 rounded-sm">
          <p className="text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">Successful</p>
          <p className="text-3xl font-bold text-emerald-600">{successCount}</p>
        </div>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 rounded-sm">
          <p className="text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest mb-2">Failed</p>
          <p className="text-3xl font-bold text-red-500">{failCount}</p>
        </div>
      </div>

      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-left px-6 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Time
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest hidden md:table-cell">
                  IP Address
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {attempts.map((attempt) => (
                <tr key={attempt.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="px-6 py-3 text-[var(--fg-muted)] text-xs whitespace-nowrap">
                    {format(new Date(attempt.createdAt), 'd MMM yyyy HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg)] font-medium text-xs">
                    {attempt.email}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-muted)] font-mono text-xs hidden md:table-cell">
                    {attempt.ipAddress ?? 'Unknown'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-bold rounded-sm ${
                        attempt.success
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-red-500/15 text-red-500 dark:text-red-400'
                      }`}
                    >
                      {attempt.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                </tr>
              ))}
              {attempts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-[var(--fg-faint)] text-sm">
                    No login attempts recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
