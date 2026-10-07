// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NewsletterSignup } from '@/components/ui/NewsletterSignup'
import { apiRequest } from '@/lib/apiClient'

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: Error) => reason }))
beforeEach(() => vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(apiRequest).mockReset() })

it('submits the visible email even when autofill does not dispatch a React change event', async () => {
  vi.mocked(apiRequest).mockResolvedValue({})
  render(<NewsletterSignup />)
  const input = screen.getByPlaceholderText('Your email address') as HTMLInputElement
  // Autofill / pre-hydration input can change the DOM without updating React state.
  input.value = 'controlled-reader@consilium.test'
  await act(async () => fireEvent.submit(input.closest('form')!))
  expect(apiRequest).toHaveBeenCalledWith('/api/subscribe', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ email: 'controlled-reader@consilium.test' }),
  }))
})

const emailInput = () => screen.getByPlaceholderText('Your email address') as HTMLInputElement
const submit = () => act(async () => fireEvent.submit(emailInput().closest('form')!))

it.each(['', '   ', '\t\n'])('never calls the API for an empty or whitespace-only address (%j)', async (value) => {
  render(<NewsletterSignup />)
  emailInput().value = value
  await submit()
  expect(apiRequest).not.toHaveBeenCalled()
  expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
})

it('never calls the API for a malformed address and keeps what was typed', async () => {
  render(<NewsletterSignup />)
  emailInput().value = 'not-an-email'
  await submit()
  expect(apiRequest).not.toHaveBeenCalled()
  expect(emailInput().value).toBe('not-an-email')
})

it('trims surrounding whitespace before calling the API', async () => {
  vi.mocked(apiRequest).mockResolvedValue({})
  render(<NewsletterSignup />)
  // A text-typed input keeps whitespace, so this checks our trim and not the browser's email sanitising.
  emailInput().type = 'text'
  emailInput().value = '  reader@consilium.test \n'
  await submit()
  expect(apiRequest).toHaveBeenCalledWith('/api/subscribe', expect.objectContaining({
    body: JSON.stringify({ email: 'reader@consilium.test' }),
  }))
})

it('preserves the entered address and shows the error when the request fails', async () => {
  vi.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('Too many requests. Please try again later.'), { status: 429 }))
  render(<NewsletterSignup />)
  emailInput().value = 'reader@consilium.test'
  await submit()
  expect(screen.getByText('Too many requests. Please try again later.')).toBeTruthy()
  expect(emailInput().value).toBe('reader@consilium.test')
})

it('ignores a second submit while the first is still in flight', async () => {
  let finish: (value: unknown) => void = () => {}
  vi.mocked(apiRequest).mockReturnValue(new Promise(resolve => { finish = resolve }))
  render(<NewsletterSignup />)
  emailInput().value = 'reader@consilium.test'
  const form = emailInput().closest('form')!
  // Both events fire before React can re-render the disabled button.
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form) })
  expect(apiRequest).toHaveBeenCalledTimes(1)
  await act(async () => finish({}))
})
