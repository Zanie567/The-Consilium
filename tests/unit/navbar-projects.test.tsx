// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const path = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => path.value, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { Navbar, projectLinks } from '@/components/layout/Navbar'
afterEach(() => { cleanup(); path.value = '/' })

const main = () => screen.getByRole('navigation', { name: 'Main navigation' })

describe('Projects in the navigation', () => {
  it('keeps the bar to the sections, a Projects button and About', () => {
    render(<Navbar />)
    expect(within(main()).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'News', 'Opinion', 'Analysis', 'Interviews', 'Debate', 'About'])
    expect(projectLinks.map((p) => p.href)).toEqual(['/trading-challenge', '/pot-noodle-index'])
  })

  it('opens and closes the project list with the button and Escape', () => {
    render(<Navbar />)
    const button = within(main()).getByRole('button', { name: 'Projects' })
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const list = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(within(list).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/trading-challenge', '/pot-noodle-index'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('marks Projects as the current section on a project page, and the page itself in the list', () => {
    path.value = '/pot-noodle-index'
    render(<Navbar />)
    const button = within(main()).getByRole('button', { name: 'Projects' })
    expect(button.hasAttribute('data-active')).toBe(true)
    fireEvent.click(button)
    expect(screen.getByRole('link', { name: /^Pot Noodle Index/ }).getAttribute('aria-current')).toBe('page')
  })

  it('lists both projects in the phone menu under their own heading', () => {
    render(<Navbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const mobile = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(within(mobile).getByText('Projects')).toBeTruthy()
    expect(within(mobile).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'News', 'Opinion', 'Analysis', 'Interviews', 'Debate', 'Trading Challenge', 'Pot Noodle Index', 'About'])
  })
})
