// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ArticleAnchorLinks } from '@/components/ui/ArticleAnchorLinks'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({ writeText: vi.fn() }) })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})
const article = () => render(<><article id="article"><h2>Repeated section</h2><h2>Repeated section</h2></article><ArticleAnchorLinks containerSelector="#article" /></>)
it('each repeated heading copies a distinct link to its own section', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
  article()
  const links = screen.getAllByRole('link', { name: 'Link to section: Repeated section' })
  expect(links[0].getAttribute('href')).toBe('#repeated-section')
  expect(links[1].getAttribute('href')).toBe('#repeated-section-2')
  await act(async () => fireEvent.click(links[1]))
  expect(writeText).toHaveBeenCalledExactlyOnceWith(`${location.origin}${location.pathname}#repeated-section-2`)
  expect(screen.getByRole('status').textContent).toContain('Section link copied.')
})
it('clipboard rejection is visible while the section navigation still completes', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Controlled clipboard denial'))
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
  article()
  await act(async () => fireEvent.click(screen.getAllByRole('link', { name: 'Link to section: Repeated section' })[0]))
  expect(location.hash).toBe('#repeated-section')
  expect(screen.getByRole('alert').textContent).toContain('Section link could not be copied.')
  expect(screen.queryByText('Section link copied.')).toBeNull()
})
