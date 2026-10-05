// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
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
it('a different reader cannot see the previous account saved position', async () => {
 vi.mocked(apiRequest).mockImplementation(() => Promise.resolve(account.current?.user.id === 'first-reader' ? { progress: 40, scrollY: 600 } : null))
 const { rerender } = render(<ReadingTracker articleId="same-article" />)
 await screen.findByText('Continue where you left off')
 account.current = { user: { id: 'second-reader' } }
 await act(async () => { rerender(<ReadingTracker articleId="same-article" />) })
 expect(screen.queryByText('Continue where you left off')).toBeNull()
})
