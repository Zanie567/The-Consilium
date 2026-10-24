import Link from 'next/link'
import { getVerifiedSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'

export const metadata: Metadata = { title: 'Subscribers | Editorial' }

export default async function AdminSubscribersPage() {
  const user = await getVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!user) {
    redirect('/editorial')
  }

  const subscribers = await prisma.subscriber
    .findMany({ orderBy: { subscribedAt: 'desc' }, select: { id: true, email: true, subscribedAt: true, status: true, weeklyDigest: true, specialAlerts: true } })
    .catch(() => [])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-8 pl-10 md:pl-0">
        <h1
          className="text-2xl font-bold text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Subscribers
        </h1>
        <p className="text-[var(--fg-muted)] text-sm mt-1">
          {subscribers.filter((s) => s.status === 'ACTIVE').length} confirmed of {subscribers.length} sign-up{subscribers.length !== 1 ? 's' : ''}. Only confirmed subscribers are mailed; see{' '}
          <Link href="/editorial/newsletter" className="text-gold underline">Newsletter</Link>.
        </p>
      </div>

      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
        {subscribers.length > 0 ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                <th className="text-left px-6 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Signed up
                </th>
                <th className="text-left px-4 py-3 text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {subscribers.map((sub) => (
                <tr key={sub.id} className="hover:bg-[var(--bg-subtle)]">
                  <td className="px-6 py-3 text-[var(--fg)] font-medium">{sub.email}</td>
                  <td className="px-4 py-3 text-[var(--fg-muted)] text-xs">
                    {format(new Date(sub.subscribedAt), 'd MMMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-muted)] text-xs whitespace-nowrap">
                    {sub.status === 'ACTIVE'
                      ? `Confirmed${sub.weeklyDigest ? ' · weekly' : ''}${sub.specialAlerts ? ' · alerts' : ''}`
                      : sub.status === 'PENDING'
                        ? 'Awaiting confirmation'
                        : sub.status === 'LEGACY'
                          ? 'Legacy (not mailed)'
                          : sub.status === 'UNSUBSCRIBED'
                            ? 'Unsubscribed'
                            : 'Suppressed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="px-6 py-16 text-center text-[var(--fg-faint)] text-sm">
            No subscribers yet.
          </div>
        )}
      </div>
    </div>
  )
}
