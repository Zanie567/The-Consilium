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
  expect(errors).toHaveLength(6)
  expect(errors.join('\n')).toContain('api/articles/abc')
  expect(errors.join('\n')).toContain('ResizeObserver')
  expect(errors.join('\n')).toContain('Application crashed')
})

it('tolerates only WebKit\'s cancelled same-origin RSC prefetch page error', () => {
  const handlers: Record<string, (value: unknown) => void> = {}
  const page = { on: (event: string, handler: (value: unknown) => void) => { handlers[event] = handler } } as unknown as Page
  const errors = collectConsoleErrors(page)
  // The exact messages seen in CI: ignored.
  handlers.pageerror(new Error('/localhost:3200/about?_rsc=10pju due to access control checks.'))
  handlers.pageerror(new Error('/localhost:3200/?_rsc=11831 due to access control checks.'))
  handlers.pageerror(new Error('/localhost:3200/?category=news&_rsc=11lxi due to access control checks.'))
  expect(errors).toEqual([])
  // Anything else stays evidence.
  handlers.pageerror(new Error('/example.com/about?_rsc=10pju due to access control checks.'))
  handlers.pageerror(new Error('/localhost:3200/about due to access control checks.'))
  handlers.pageerror(new Error('/localhost:3200/api/articles/1 due to access control checks.'))
  handlers.pageerror(new Error('/localhost:3200/about?_rsc=10pju failed with status 500'))
  handlers.pageerror(new Error('TypeError: Load failed /localhost:3200/about?_rsc=10pju due to access control checks.'))
  handlers.console({ type: () => 'error', text: () => '/localhost:3200/about?_rsc=10pju due to access control checks.', location: () => ({ url: 'http://localhost:3200/' }) })
  expect(errors).toHaveLength(6)
})
