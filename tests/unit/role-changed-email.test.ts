import { describe, expect, it } from 'vitest'
import { roleChangedEmail } from '@/lib/email'

describe('roleChangedEmail', () => {
  it.each(['WRITER', 'EDITOR', 'GROWTH'])('tells a new %s they can start now, and about Team Profile', (role) => {
    const { subject, html } = roleChangedEmail('Sam', role, true)
    expect(subject).toContain('granted')
    expect(html).toMatch(/reload the page/i)
    expect(html).toMatch(/don't need to sign in again/i)
    expect(html).toContain('Team Profile')
  })

  it('does not claim a re-login is needed, and promises no profile for non-team roles', () => {
    for (const role of ['READER', 'ADMIN']) {
      const { html } = roleChangedEmail('Sam', role, false)
      expect(html).not.toMatch(/next time you sign in/i)
      expect(html).not.toContain('Team Profile')
    }
  })

  it('escapes the recipient name', () => {
    expect(roleChangedEmail('<b>x</b>', 'WRITER', true).html).not.toContain('<b>x</b>')
  })
})
