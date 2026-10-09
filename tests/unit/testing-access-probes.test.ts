import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { probesFor, judgeProbe, wasRefused, type Probe } from '@/lib/testingAccessProbes'

const ok = { status: 200, finalPath: '/x', bodyText: 'Welcome' }

describe('access probes by persona', () => {
  it('a writer is expected to open their own menu and to be refused every administrator page and API', () => {
    const probes = probesFor('writer')
    const byExpect = (e: Probe['expect']) => probes.filter((p) => p.expect === e).map((p) => p.url)
    expect(byExpect('allowed')).toEqual(expect.arrayContaining(['/editorial', '/editorial/team-profile', '/editorial/articles', '/editorial/articles/new']))
    expect(byExpect('allowed')).not.toContain('/editorial/members')
    expect(byExpect('allowed')).not.toContain('/admin/testing')
    expect(byExpect('denied')).toEqual(expect.arrayContaining(['/editorial/members', '/editorial/users', '/admin/login-attempts', '/admin/data', '/api/admin/team-members']))
  })
  it('an editor may open Subscribers and Debates but not People management', () => {
    const probes = probesFor('editor')
    const allowed = probes.filter((p) => p.expect === 'allowed').map((p) => p.url)
    expect(allowed).toEqual(expect.arrayContaining(['/admin/subscribers', '/editorial/debates', '/editorial/review']))
    expect(probes.filter((p) => p.expect === 'denied').map((p) => p.url)).toEqual(expect.arrayContaining(['/editorial/members', '/admin/data']))
  })
  it('never expects the same url to be both allowed and denied', () => {
    for (const persona of ['writer', 'writer-other', 'editor', 'editor-global', 'growth'] as const) {
      const probes = probesFor(persona)
      const allowed = new Set(probes.filter((p) => p.expect === 'allowed').map((p) => p.url))
      for (const p of probes.filter((x) => x.expect === 'denied')) expect(allowed.has(p.url), `${persona} ${p.url}`).toBe(false)
    }
  })
})

describe('judging a probe', () => {
  const page = (expectation: Probe['expect']): Probe => ({ kind: 'page', url: '/editorial/members', expect: expectation, label: 'x' })
  const api = (expectation: Probe['expect']): Probe => ({ kind: 'api', url: '/api/admin/audit-log', expect: expectation, label: 'x' })

  it('an error status, a redirect elsewhere and an access-denied screen all count as refused', () => {
    expect(wasRefused(page('denied'), { status: 403, finalPath: '/editorial/members', bodyText: '' })).toBe(true)
    expect(wasRefused(page('denied'), { status: 200, finalPath: '/editorial', bodyText: 'Dashboard' })).toBe(true)
    expect(wasRefused(page('denied'), { status: 200, finalPath: '/editorial/members', bodyText: '403 Access Denied' })).toBe(true)
    expect(wasRefused(page('denied'), { status: 200, finalPath: '/editorial/members', bodyText: 'This page could not be found' })).toBe(true)
  })
  it('a page that opens normally is not refused', () => {
    expect(wasRefused(page('allowed'), { status: 200, finalPath: '/editorial/members', bodyText: 'Team Members' })).toBe(false)
  })
  it('an API is judged by status alone (redirect and body text do not matter)', () => {
    expect(wasRefused(api('denied'), { status: 200, finalPath: '/somewhere', bodyText: 'Access Denied' })).toBe(false)
    expect(wasRefused(api('denied'), { status: 401, finalPath: '/api/admin/audit-log', bodyText: '' })).toBe(true)
  })
  it('passes when an expected denial is refused or an expected allowance opens, and fails otherwise', () => {
    expect(judgeProbe(page('denied'), { status: 403, finalPath: '/editorial/members', bodyText: '' }).pass).toBe(true)
    expect(judgeProbe(page('denied'), { status: 200, finalPath: '/editorial/members', bodyText: 'Team Members' })).toMatchObject({ pass: false, detail: 'opened (200)' })
    expect(judgeProbe({ ...page('allowed'), url: '/editorial' }, { ...ok, finalPath: '/editorial' }).pass).toBe(true)
    expect(judgeProbe({ ...page('allowed'), url: '/editorial' }, { status: 200, finalPath: '/editorial/login', bodyText: '' }).pass).toBe(false)
  })
})
