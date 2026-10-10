import { describe, it, expect } from 'vitest'
import { buildNav, navHrefs } from '@/lib/adminNav'
import { buildAttentionItems, type AdminOverview } from '@/lib/adminOverview'

const ADMIN_ONLY_HREFS = [
  '/editorial/members', '/editorial/users', '/editorial/analytics', '/editorial/predictions', '/editorial/glossary',
  '/editorial/calendar', '/admin/login-attempts', '/admin/data', '/admin/testing',
]
const EDITOR_HREFS = [
  '/editorial/debates', '/editorial/series', '/editorial/scheduled', '/editorial/trash', '/editorial/review',
  '/editorial/comments', '/admin/subscribers',
]
const hrefs = (role: string) => navHrefs({ role })

describe('navigation by role', () => {
  it('an administrator is offered everything, in the agreed groups and order', () => {
    const groups = buildNav({ role: 'ADMIN' })
    expect(groups.map((g) => g.id)).toEqual(['overview', 'content', 'review', 'people', 'insights', 'administration', 'testing'])
    const all = hrefs('ADMIN')
    for (const href of [...ADMIN_ONLY_HREFS, ...EDITOR_HREFS]) expect(all, href).toContain(href)
    const labels = (id: string) => groups.find((g) => g.id === id)!.items.map((i) => i.label)
    expect(labels('overview')).toEqual(['Dashboard', 'Team Profile'])
    expect(labels('content')).toEqual(expect.arrayContaining(['All Articles', 'New Article', 'Debates']))
    expect(labels('people')).toEqual(['Team Members', 'Users', 'Subscribers'])
    expect(labels('administration')).toEqual(['Login Attempts', 'Data Management'])
  })

  it('Testing sits in its own group, apart from everyday administration', () => {
    const groups = buildNav({ role: 'ADMIN' })
    const testing = groups.find((g) => g.id === 'testing')!
    expect(testing.items.map((i) => i.label)).toEqual(['Testing'])
    expect(groups.find((g) => g.id === 'administration')!.items.map((i) => i.label)).not.toContain('Testing')
    expect(groups.at(-1)!.id).toBe('testing')
  })

  it('"Members" is now "Team Members"', () => {
    const items = buildNav({ role: 'ADMIN' }).flatMap((g) => g.items)
    expect(items.find((i) => i.href === '/editorial/members')?.label).toBe('Team Members')
    expect(items.some((i) => i.label === 'Members')).toBe(false)
  })

  it('an editor gets editorial tools but no administration, people management or testing', () => {
    const all = hrefs('EDITOR')
    for (const href of EDITOR_HREFS) expect(all, href).toContain(href)
    for (const href of ADMIN_ONLY_HREFS) expect(all, href).not.toContain(href)
    expect(buildNav({ role: 'EDITOR' }).map((g) => g.id)).not.toContain('administration')
    expect(buildNav({ role: 'EDITOR' }).map((g) => g.id)).not.toContain('testing')
  })

  it('a writer sees only their own writing tools, and still reaches their own profile', () => {
    const all = hrefs('WRITER')
    expect(all).toEqual(expect.arrayContaining(['/editorial', '/editorial/team-profile', '/editorial/articles', '/editorial/articles/new', '/editorial/readers', '/editorial/leaderboard']))
    for (const href of [...ADMIN_ONLY_HREFS, ...EDITOR_HREFS]) expect(all, href).not.toContain(href)
    expect(buildNav({ role: 'WRITER' }).flatMap((g) => g.items).find((i) => i.href === '/editorial/articles')?.label).toBe('My Articles')
  })

  it('growth gets its own small set and nothing from editing or administration', () => {
    expect(hrefs('GROWTH')).toEqual([
      '/editorial', '/editorial/analytics', '/editorial/growth/subscribers', '/editorial/growth/engagement', '/editorial/team-profile',
    ])
  })

  it('a reader or unknown role is offered nothing administrative', () => {
    for (const role of ['READER', 'nonsense', '']) {
      const all = hrefs(role)
      for (const href of [...ADMIN_ONLY_HREFS, ...EDITOR_HREFS, '/editorial/team-profile']) expect(all, `${role} ${href}`).not.toContain(href)
    }
  })

  it('no role is ever offered the same destination twice, and the trash badge only appears when there is trash', () => {
    for (const role of ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH']) {
      const all = hrefs(role)
      expect(new Set(all).size, role).toBe(all.length)
    }
    const trash = (n: number) => buildNav({ role: 'ADMIN', trashCount: n }).flatMap((g) => g.items).find((i) => i.href === '/editorial/trash')!
    expect(trash(0).badge).toBeUndefined()
    expect(trash(3).badge).toBe(3)
  })
})

const base = (): AdminOverview => ({
  content: { published: 10, drafts: 2, pendingReview: 0, scheduledOverdue: 0, trashed: 0 },
  debates: { published: 1, unpublished: 0, deleted: 0 },
  team: { staff: 5, needProfile: 0, pendingInvites: 0 },
  audience: { subscribers: 40, newLast30Days: 3 },
  security: { failedSignIns24h: 0 },
  system: { deploymentHealthy: true, deploymentGaps: [], testingReady: false, testingReason: 'x' },
})

describe('attention list', () => {
  it('is empty when nothing is waiting', () => {
    expect(buildAttentionItems(base())).toEqual([])
  })
  it('surfaces each waiting item with a link, most urgent first', () => {
    const o = base()
    o.system = { ...o.system, deploymentHealthy: false, deploymentGaps: ['Missing schema: debates.deletedAt'] }
    o.content = { ...o.content, scheduledOverdue: 2, pendingReview: 1 }
    o.team = { staff: 5, needProfile: 3, pendingInvites: 1 }
    o.security = { failedSignIns24h: 14 }
    const items = buildAttentionItems(o)
    expect(items.map((i) => i.id)).toEqual(['deployment', 'overdue', 'review', 'profiles', 'signins', 'invites'])
    expect(items.find((i) => i.id === 'profiles')).toMatchObject({ message: '3 team accounts have no public profile', href: '/editorial/members' })
    expect(items.find((i) => i.id === 'review')?.message).toBe('1 article is waiting for review')
    expect(items.find((i) => i.id === 'invites')?.tone).toBe('info')
  })
  it('does not alarm on a few failed sign-ins, and treats unavailable figures as "nothing to report", not zero-risk', () => {
    const o = base()
    o.security = { failedSignIns24h: 9 }
    expect(buildAttentionItems(o)).toEqual([])
    o.content = { published: null, drafts: null, pendingReview: null, scheduledOverdue: null, trashed: null }
    expect(buildAttentionItems(o)).toEqual([])
  })
})
