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
