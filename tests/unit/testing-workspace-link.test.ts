import { it, expect } from 'vitest'
import { testingWorkspaceLink } from '../../src/lib/testingWorkspaceLink'
it('links an independent origin without carrying authentication', () => {
  expect(testingWorkspaceLink('https://testing.example.org')).toBe('https://testing.example.org/admin/testing')
  expect(testingWorkspaceLink('http://localhost:3340')).toBe('http://localhost:3340/admin/testing')
})
it.each(['https://user:password@example.org', 'https://example.org?token=secret', 'https://example.org/#session', 'https://example.org/path', 'http://example.org', 'javascript:alert(1)', undefined])('rejects unsafe workspace URL %s', value => {
  expect(testingWorkspaceLink(value)).toBeNull()
})
