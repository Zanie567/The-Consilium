// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CommentsPage from '@/app/editorial/(portal)/comments/page'
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { role: 'ADMIN' } } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (body: string, status = 200) => ({ ok: status === 200, status, json: async () => ({ comments: [{ id: body, body, createdAt: '2026-10-04T12:00:00Z', isReported: false, isHidden: true, upvotes: 0, user: { id: 'reader', name: 'Reader' }, article: { id: 'article', title: 'Article', slug: 'article' } }], total: 1, stats: { total: 1, reported: 0, hidden: 1 } }) })
it.each([200, 503])('obsolete recent response %s cannot replace the Hidden selection', async status => {
 let resolve!: (value: ReturnType<typeof response>) => void
 const old = new Promise<ReturnType<typeof response>>(yes => { resolve = yes })
 vi.stubGlobal('fetch', vi.fn().mockImplementation(url => String(url).includes('tab=recent') ? old : Promise.resolve(response(String(url).includes('tab=hidden') ? 'Current hidden comment' : 'Initial comment'))))
 render(<CommentsPage />)
 await screen.findByText('Initial comment')
 fireEvent.click(screen.getByRole('button', { name: 'Recent' }))
 fireEvent.click(screen.getByRole('button', { name: /^Hidden/ }))
 await screen.findByText('Current hidden comment')
 await act(async () => { resolve(response('Obsolete recent comment', status)); await old })
 expect(screen.queryByText('Current hidden comment')).not.toBeNull()
 expect(screen.queryByText('Obsolete recent comment')).toBeNull()
 expect(screen.queryByText(/couldn't load the comments/)).toBeNull()
})
