// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorialLoginForm } from '@/app/editorial/login/EditorialLoginForm'
import { signIn } from 'next-auth/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(signIn).mockReset() })

it('a refused reset request retains the email, reports failure and allows deliberate retry', async () => {
  const request = vi.fn().mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 })
  vi.stubGlobal('fetch', request)
  render(<EditorialLoginForm />)
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  const email = screen.getByPlaceholderText('your@email.com')
  fireEvent.change(email, { target: { value: 'controlled-writer@consilium.test' } })
  await act(async () => fireEvent.submit(email.closest('form')!))
  expect(screen.queryByText(/receive a reset link shortly/)).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('Reset request failed. Please try again.')
  expect((email as HTMLInputElement).value).toBe('controlled-writer@consilium.test')
  expect((screen.getByRole('button', { name: 'Send Reset Link' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => fireEvent.submit(email.closest('form')!))
  expect(screen.getByText(/receive a reset link shortly/)).toBeTruthy()
  expect(request).toHaveBeenCalledTimes(2)
})

it('a disconnected reset request keeps its input and returns the submit control', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Controlled disconnect')))
  render(<EditorialLoginForm />)
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  const email = screen.getByPlaceholderText('your@email.com')
  fireEvent.change(email, { target: { value: 'controlled-writer@consilium.test' } })
  await act(async () => fireEvent.submit(email.closest('form')!))
  expect(screen.getByRole('alert').textContent).toContain('Check your connection and try again.')
  expect((email as HTMLInputElement).value).toBe('controlled-writer@consilium.test')
  expect((screen.getByRole('button', { name: 'Send Reset Link' }) as HTMLButtonElement).disabled).toBe(false)
})

it('a disconnected credentials request keeps both fields and returns the sign-in control', async () => {
  vi.mocked(signIn).mockRejectedValue(new TypeError('Controlled disconnect'))
  render(<EditorialLoginForm />)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'controlled-writer@consilium.test' } })
  const password = screen.getByLabelText('Password')
  fireEvent.change(password, { target: { value: 'Controlled-password-123' } })
  await act(async () => fireEvent.submit(password.closest('form')!))
  expect(screen.getByRole('alert').textContent).toContain('Check your connection and try again.')
  expect((password as HTMLInputElement).value).toBe('Controlled-password-123')
  expect((screen.getByRole('button', { name: 'Sign In' }) as HTMLButtonElement).disabled).toBe(false)
})
