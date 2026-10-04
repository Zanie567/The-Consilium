import { expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import { collectConsoleErrors } from '../e2e/helpers/console'

it('retains application failures and every uncaught exception', () => {
  const handlers: Record<string, (value: unknown) => void> = {}
  const page = { on: (event: string, handler: (value: unknown) => void) => { handlers[event] = handler } } as unknown as Page
  const errors = collectConsoleErrors(page)
  const emit = (message: string, url: string) => handlers.console({
    type: () => 'error', text: () => message, location: () => ({ url }),
  })
  emit('Failed to load resource: status of 500', 'http://localhost:3320/api/articles/abc')
  emit('net::ERR_ABORTED', 'http://localhost:3320/api/upload')
  emit('Failed to load resource favicon.ico', 'http://localhost:3320/favicon.ico')
  handlers.pageerror(new Error('ResizeObserver loop limit exceeded'))
  handlers.pageerror(new Error('net::ERR_ABORTED in application code'))
  emit('Failed to load resource', 'https://images.unsplash.com/missing.png')
  emit('Application crashed', 'https://images.unsplash.com/script.js')
  expect(errors).toHaveLength(7)
  expect(errors.join('\n')).toContain('api/articles/abc')
  expect(errors.join('\n')).toContain('ResizeObserver')
  expect(errors.join('\n')).toContain('Application crashed')
  expect(errors.join('\n')).toContain('missing.png')
})
