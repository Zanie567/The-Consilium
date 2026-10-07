import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EditorialLayout from '@/app/editorial/(portal)/layout'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, article: { count: vi.fn().mockResolvedValue(7) } } }))
vi.mock('@/components/layout/EditorialSidebarWrapper', () => ({ EditorialSidebarWrapper: () => <aside>Restricted sidebar</aside> }))
vi.mock('@/components/editorial/PortalTransition', () => ({ PortalTransition: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

beforeEach(() => { vi.clearAllMocks(); vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'banned', role: 'READER' } } as never) })
it.each(['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'])('a currently banned %s cannot render portal chrome or query its trash count', async role => {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role, isActive: true, isBanned: true, name: 'Restricted account', email: 'restricted@consilium.test', image: null } as never)
  const html = renderToStaticMarkup(await EditorialLayout({ children: 'Restricted child' }))
  expect(html).toContain('Access Denied')
  expect(html).not.toContain('Restricted sidebar')
  expect(html).not.toContain('Restricted child')
  expect(prisma.article.count).not.toHaveBeenCalled()
})
