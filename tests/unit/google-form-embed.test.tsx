// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GoogleFormEmbed } from '@/components/ui/GoogleFormEmbed'

const consent = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/components/ui/CookieConsent', () => ({ getCookieConsent: () => consent.value }))

let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {}
class IO { constructor(cb: typeof intersect) { intersect = cb } observe() {} disconnect() {} }
vi.stubGlobal('IntersectionObserver', IO)

const RESPONDER = 'https://docs.google.com/forms/d/e/abc/viewform'
const EMBED = 'https://docs.google.com/forms/d/e/abc/viewform?embedded=true'
const frame = () => document.querySelector('iframe')
afterEach(() => { cleanup(); consent.value = null; window.location.hash = '' })

describe('GoogleFormEmbed', () => {
  it('does not load Google until asked, and the direct link works throughout', () => {
    render(<GoogleFormEmbed responderUrl={RESPONDER} embedUrl={EMBED} title="Form" label="Form label" />)
    expect(frame()).toBeNull()
    expect(screen.getByRole('link', { name: /Open in Google Forms/ }).getAttribute('href')).toBe(RESPONDER)
    fireEvent.click(screen.getByRole('button', { name: 'Load the form here' }))
    expect(frame()?.getAttribute('src')).toBe(EMBED)
    expect(frame()?.getAttribute('sandbox')).toContain('allow-forms')
    expect(frame()?.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  })

  it('loads near the viewport only for visitors who accepted cookies', () => {
    render(<GoogleFormEmbed responderUrl={RESPONDER} embedUrl={EMBED} title="Form" label="L" />)
    act(() => intersect([{ isIntersecting: true }]))
    expect(frame()).toBeNull()
    cleanup()
    consent.value = 'accepted'
    render(<GoogleFormEmbed responderUrl={RESPONDER} embedUrl={EMBED} title="Form" label="L" />)
    act(() => intersect([{ isIntersecting: true }]))
    expect(frame()).not.toBeNull()
  })

  it('loads when the page is opened at its #hash', () => {
    window.location.hash = '#take-part'
    render(<GoogleFormEmbed responderUrl={RESPONDER} embedUrl={EMBED} title="Form" label="L" intentHash="take-part" />)
    expect(frame()).not.toBeNull()
  })

  it('says it is loading, never that anything was submitted, and offers the direct link if slow', () => {
    vi.useFakeTimers()
    try {
      render(<GoogleFormEmbed responderUrl={RESPONDER} embedUrl={EMBED} title="Form" label="L" />)
      fireEvent.click(screen.getByRole('button', { name: 'Load the form here' }))
      expect(screen.getByRole('status').textContent).toBe('Loading the form…')
      act(() => { vi.advanceTimersByTime(12_000) })
      expect(screen.getByRole('link', { name: 'Open it in Google Forms instead' })).toBeTruthy()
      fireEvent.load(frame()!)
      expect(screen.queryByRole('status')).toBeNull()
      expect(document.body.textContent).not.toMatch(/submitted|thank you|success/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a link that cannot be embedded offers the direct link only', () => {
    render(<GoogleFormEmbed responderUrl="https://forms.gle/abc" embedUrl={null} title="Form" label="L" />)
    expect(screen.queryByRole('button', { name: 'Load the form here' })).toBeNull()
    expect(screen.getAllByRole('link', { name: /Open in Google Forms/ })).toHaveLength(2)
  })
})
