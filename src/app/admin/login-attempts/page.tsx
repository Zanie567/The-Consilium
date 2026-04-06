import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Login Attempts' }

export default async function LoginAttemptsPage() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as { role: string }).role !== 'ADMIN') redirect('/admin')

  const attempts = await prisma.loginAttempt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const failCount = attempts.filter((a) => !a.success).length
  const successCount = attempts.filter((a) => a.success).length

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-navy" style={{ fontFamily: 'var(--font-serif)' }}>
          Login Attempts
        </h1>
        <p className="text-navy/50 text-sm mt-1">Last 200 login attempts across all accounts</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white border border-gold/15 p-5 rounded-sm">
          <p className="text-navy/50 text-xs font-bold uppercase tracking-widest mb-2">Successful</p>
          <p className="text-3xl font-bold text-green-700">{successCount}</p>
        </div>
        <div className="bg-white border border-gold/15 p-5 rounded-sm">
          <p className="text-navy/50 text-xs font-bold uppercase tracking-widest mb-2">Failed</p>
          <p className="text-3xl font-bold text-red-700">{failCount}</p>
        </div>
      </div>

      <div className="bg-white border border-gold/15 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gold/10">
                <th className="text-left px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Time
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden md:table-cell">
                  IP Address
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {attempts.map((attempt) => (
                <tr key={attempt.id} className="hover:bg-cream/50 transition-colors">
                  <td className="px-6 py-3 text-navy/60 text-xs whitespace-nowrap">
                    {format(new Date(attempt.createdAt), 'd MMM yyyy HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3 text-navy font-medium text-xs">
                    {attempt.email}
                  </td>
                  <td className="px-4 py-3 text-navy/60 font-mono text-xs hidden md:table-cell">
                    {attempt.ipAddress ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-bold rounded-sm ${
                        attempt.success
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {attempt.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                </tr>
              ))}
              {attempts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-navy/30 text-sm">
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
