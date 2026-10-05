import { expect, it, vi } from 'vitest'
import TrashPage from '@/app/editorial/(portal)/trash/page'
import { prisma } from '@/lib/prisma'
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'owner', role: 'WRITER' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { article: { findMany: vi.fn() } } }))

it('a failed trash load reaches the error boundary instead of claiming the trash is empty', async () => {
  const failure = new Error('Controlled database read failure')
  vi.mocked(prisma.article.findMany).mockRejectedValue(failure)
  await expect(TrashPage()).rejects.toBe(failure)
})
