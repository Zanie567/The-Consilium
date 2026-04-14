import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DebateCreator } from './DebateCreator'

export const dynamic = 'force-dynamic'

export default async function NewDebatePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user || !['ADMIN', 'EDITOR'].includes(session.user.role ?? '')) {
    redirect('/editorial/login')
  }

  const [authors, categories] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'EDITOR', 'WRITER'] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  ])

  return <DebateCreator authors={authors} categories={categories} />
}
