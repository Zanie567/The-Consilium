// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReadingTracker } from '@/components/ui/ReadingTracker'
import { apiRequest } from '@/lib/apiClient'
const { account } = vi.hoisted(() => ({ account: { current: { user: { id: 'first-reader' } } as { user: { id: string } } | null } }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: account.current }) }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
afterEach(() => { cleanup(); vi.mocked(apiRequest).mockReset(); account.current = { user: { id: 'first-reader' } } })
it('an article without saved progress cannot retain the previous article restore banner', async () => {
 vi.mocked(apiRequest).mockImplementation(url => Promise.resolve(String(url).endsWith('/first') ? { progress: 40, scrollY: 600 } : null))
 const { rerender } = render(<ReadingTracker articleId="first" />)
 await screen.findByText('Continue where you left off')
 await act(async () => { rerender(<ReadingTracker articleId="second" />) })
 expect(screen.queryByText('Continue where you left off')).toBeNull()
})
it('a route/layout scroll cannot write reading progress until the reader interacts in this scope', async () => {
 vi.mocked(apiRequest).mockResolvedValue(null)
 render(<ReadingTracker articleId="destination" />)
 await act(async () => {})
 await act(async () => { fireEvent.scroll(window) })
 expect(vi.mocked(apiRequest).mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([])
 await act(async () => { fireEvent.wheel(window, { deltaY: 500 }); fireEvent.scroll(window) })
 const writes = vi.mocked(apiRequest).mock.calls.filter(([, options]) => options?.method === 'POST')
 expect(writes).toHaveLength(1)
 expect(JSON.parse(writes[0][1]!.body as string).articleId).toBe('destination')
})
it('a different reader cannot see the previous account saved position', async () => {
 vi.mocked(apiRequest).mockImplementation(() => Promise.resolve(account.current?.user.id === 'first-reader' ? { progress: 40, scrollY: 600 } : null))
 const { rerender } = render(<ReadingTracker articleId="same-article" />)
 await screen.findByText('Continue where you left off')
 account.current = { user: { id: 'second-reader' } }
 await act(async () => { rerender(<ReadingTracker articleId="same-article" />) })
 expect(screen.queryByText('Continue where you left off')).toBeNull()
})
