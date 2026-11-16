// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const path = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => path.value, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }))

import { Navbar } from '@/components/layout/Navbar'
afterEach(() => { cleanup(); path.value = '/' })

const LINKS = ['Home', 'News', 'Opinion', 'Analysis', 'Interviews', 'Debate', 'Trading', 'Pot Noodle Index', 'About']

describe('header navigation', () => {
  it('gives the Trading Challenge and the Pot Noodle Index their own entries, with no grouping', () => {
    render(<Navbar />)
    const main = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(main).getAllByRole('link').map((a) => a.textContent)).toEqual(LINKS)
    expect(within(main).getByRole('link', { name: 'Trading' }).getAttribute('href')).toBe('/trading-challenge')
    expect(within(main).getByRole('link', { name: 'Pot Noodle Index' }).getAttribute('href')).toBe('/pot-noodle-index')
    expect(within(main).queryByRole('button')).toBeNull()
    expect(screen.queryByText('Projects')).toBeNull()
  })

  it('marks each project page as current on its own', () => {
    path.value = '/pot-noodle-index'
    render(<Navbar />)
    const main = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(main).getByRole('link', { name: 'Pot Noodle Index' }).getAttribute('aria-current')).toBe('page')
    expect(within(main).getByRole('link', { name: 'Trading' }).getAttribute('aria-current')).toBeNull()
  })

  it('lists the same entries, in the same order, in the phone menu', () => {
    render(<Navbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const mobile = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(within(mobile).getAllByRole('link').map((a) => a.textContent)).toEqual(LINKS)
  })
})
