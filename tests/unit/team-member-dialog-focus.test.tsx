// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TeamMemberDialog } from '@/components/team/TeamMemberDialog'

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }))
beforeEach(() => vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const member = { id: 'm1', name: 'Alex Writer', role: 'Writer', bio: 'A biography.', image: null, email: 'alex@consilium.test', authorSlug: 'alex-writer' }

// A real browser decides where Tab goes from a programmatically focused panel, and engines differ
// (WebKit left the dialog once it was portalled). The trap must not depend on that.
const open = async () => {
  render(<TeamMemberDialog member={member} open onClose={() => {}} />)
  const dialog = await screen.findByRole('dialog')
  await act(async () => {})
  expect(document.activeElement).toBe(dialog)
  return dialog
}

it('renders the dialog in document.body, outside any transformed ancestor', async () => {
  const { container } = render(<div style={{ transform: 'translateY(20px)' }}><TeamMemberDialog member={member} open onClose={() => {}} /></div>)
  const dialog = await screen.findByRole('dialog')
  expect(container.contains(dialog)).toBe(false)
  expect(document.body.contains(dialog)).toBe(true)
})

it('Tab from the focused panel moves to the first control inside the dialog', async () => {
  const dialog = await open()
  fireEvent.keyDown(window, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close profile for Alex Writer' }))
  expect(dialog.contains(document.activeElement)).toBe(true)
})

it('Shift+Tab from the focused panel moves to the last control inside the dialog', async () => {
  await open()
  fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
  const links = screen.getAllByRole('link')
  expect(document.activeElement).toBe(links[links.length - 1])
})

it('Tab from outside the dialog is pulled back inside', async () => {
  const dialog = await open()
  const outside = document.body.appendChild(document.createElement('button'))
  outside.focus()
  fireEvent.keyDown(window, { key: 'Tab' })
  expect(dialog.contains(document.activeElement)).toBe(true)
})

it('returns focus to the opening card even when the browser never focused it on click (Safari)', async () => {
  const trigger = document.body.appendChild(document.createElement('button'))
  const returnFocusRef = { current: trigger }
  const view = render(<TeamMemberDialog member={member} open onClose={() => {}} returnFocusRef={returnFocusRef} />)
  await screen.findByRole('dialog')
  await act(async () => {})
  expect(document.activeElement).not.toBe(trigger)
  view.rerender(<TeamMemberDialog member={member} open={false} onClose={() => {}} returnFocusRef={returnFocusRef} />)
  await act(async () => {})
  expect(document.activeElement).toBe(trigger)
})
