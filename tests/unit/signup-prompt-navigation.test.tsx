// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SignupPrompt } from '@/components/ui/SignupPrompt'
const { path } = vi.hoisted(() => ({ path: { current: '/' } }))
vi.mock('next/navigation', () => ({ usePathname: () => path.current }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }))
vi.mock('@/components/ui/CookieConsent', () => ({ getCookieConsent: () => 'accepted' }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
beforeEach(() => {
  vi.useFakeTimers(); path.current = '/'
  for (const name of ['consilium_visits', 'consilium_prompt_dismissed']) document.cookie = `${name}=; max-age=0; path=/`
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('counts actual client route changes and offers signup after the third visit', () => {
  const { rerender } = render(<SignupPrompt />)
  expect(document.cookie).toContain('consilium_visits=1')
  path.current = '/category/news'; rerender(<SignupPrompt />)
  expect(document.cookie).toContain('consilium_visits=2')
  path.current = '/about'; rerender(<SignupPrompt />)
  expect(document.cookie).toContain('consilium_visits=3')
  act(() => vi.advanceTimersByTime(3500))
  expect(screen.getByRole('dialog', { name: 'Create an account' })).not.toBeNull()
})
