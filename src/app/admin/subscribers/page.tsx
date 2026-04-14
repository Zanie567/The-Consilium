import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Subscribers | Admin' }

export default async function AdminSubscribersPage() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'EDITOR')) {
    redirect('/editorial')
  }

  const subscribers = await prisma.subscriber
    .findMany({ orderBy: { subscribedAt: 'desc' } })
    .catch(() => [])

  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-3xl font-bold text-navy"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Subscribers
        </h1>
        <p className="text-navy/50 text-sm mt-1">
          {subscribers.length} newsletter subscriber{subscribers.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="bg-white border border-gold/15 overflow-hidden">
        {subscribers.length > 0 ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gold/15 bg-cream/50">
                <th className="text-left px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Subscribed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {subscribers.map((sub) => (
                <tr key={sub.id} className="hover:bg-cream/30">
                  <td className="px-6 py-3 text-navy font-medium">{sub.email}</td>
                  <td className="px-4 py-3 text-navy/50 text-xs">
                    {format(new Date(sub.subscribedAt), 'd MMMM yyyy')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="px-6 py-16 text-center text-navy/30 text-sm">
            No subscribers yet.
          </div>
        )}
      </div>
    </div>
  )
}
