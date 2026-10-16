// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TeamMemberDialog } from '@/components/team/TeamMemberDialog'
import type { TeamCardMember } from '@/components/team/TeamMemberCard'

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }))
beforeEach(() => vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const member = (overrides: Partial<TeamCardMember> = {}): TeamCardMember => ({
  id: 'm1', name: 'Annika Example', role: 'Senior Editor', bio: 'A biography.', image: null,
  email: 'annika@consilium.test', authorPage: null, ...overrides,
})
const openDialog = async (m: TeamCardMember) => {
  render(<TeamMemberDialog member={m} open onClose={() => {}} />)
  const dialog = await screen.findByRole('dialog')
  await act(async () => {})
  return dialog
}
const articlesLink = () => screen.queryByRole('link', { name: /read their articles/i })

it('shows the author link, with the existing button styling, when they have published', async () => {
  await openDialog(member({ authorPage: '/author/cm9annika' }))
  const link = articlesLink()!
  expect(link.getAttribute('href')).toBe('/author/cm9annika')
  expect(link.textContent).toBe('Read their articles →')
  for (const cls of ['border-gold/50', 'uppercase', 'text-gold', 'hover:bg-gold', 'hover:text-navy']) {
    expect(link.className).toContain(cls)
  }
})

it('shows no author link when they have not published, and keeps the email link', async () => {
  await openDialog(member({ authorPage: null }))
  expect(articlesLink()).toBeNull()
  expect(screen.getByRole('link', { name: 'annika@consilium.test' }).getAttribute('href')).toBe('mailto:annika@consilium.test')
})

it('shows the author link without an email', async () => {
  await openDialog(member({ email: null, authorPage: '/author/annika' }))
  expect(articlesLink()?.getAttribute('href')).toBe('/author/annika')
  expect(screen.queryByRole('link', { name: /@/ })).toBeNull()
})

it('keeps the author link inside the keyboard focus trap, before the email link', async () => {
  await openDialog(member({ authorPage: '/author/annika' }))
  fireEvent.keyDown(window, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close profile for Annika Example' }))
  fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
  expect(document.activeElement?.getAttribute('href')).toBe('mailto:annika@consilium.test')
  const links = screen.getAllByRole('link')
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['/author/annika', 'mailto:annika@consilium.test'])
})
