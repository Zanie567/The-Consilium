/**
 * The portal navigation, as data. One definition drives the sidebar for every role, so what a
 * writer, editor, growth member or administrator sees is decided here and can be unit-tested
 * without rendering anything.
 *
 * Hiding a link is NOT access control: every page and API behind these links re-checks the role
 * on the server. This module only decides what is worth offering.
 *
 * Groups, in order:
 *   (Overview)            Dashboard, Team Profile (own profile, for roles that have one)
 *   Content               articles, drafts, series, scheduling, trash, debates
 *   Review                review queue, comments                             editors and admins
 *   People & Audience     Team Members, Users, Subscribers                   admins (subscribers: editors too)
 *   Insights              analytics, readers, predictions, glossary, leaderboard
 *   Administration        Login Attempts, Data Management                    admins
 *   Testing               role testing, kept apart from everyday administration (admins)
 */
import {
  CALENDAR_ACCESS_ROLES,
  GLOSSARY_MANAGE_ROLES,
  PREDICTIONS_MANAGE_ROLES,
  isAllowedRole,
} from '@/lib/rbac'
import { TEAM_PROFILE_ROLES } from '@/lib/teamProfiles'

export type NavIcon =
  | 'dashboard' | 'profile' | 'file' | 'pencil' | 'plus' | 'series' | 'clock' | 'calendar' | 'trash'
  | 'debates' | 'review' | 'comments' | 'members' | 'users' | 'mail' | 'analytics' | 'readers'
  | 'target' | 'glossary' | 'trophy' | 'engagement' | 'subscribers' | 'shield' | 'database' | 'flask'

export interface NavItemSpec {
  href: string
  label: string
  icon: NavIcon
  /** Active only on exactly this path (not on sub-paths). */
  exact?: boolean
  badge?: number
}

export interface NavGroupSpec {
  id: 'overview' | 'content' | 'review' | 'people' | 'insights' | 'administration' | 'testing' | 'growth'
  label?: string
  items: NavItemSpec[]
}

export interface NavInput {
  role: string
  /** Number of trashed articles, shown as a badge on Trash. */
  trashCount?: number
}

export function buildNav({ role, trashCount = 0 }: NavInput): NavGroupSpec[] {
  const isAdmin = role === 'ADMIN'
  const isEditor = role === 'ADMIN' || role === 'EDITOR'
  const canEditOwnProfile = isAllowedRole(role, TEAM_PROFILE_ROLES)

  if (role === 'GROWTH') {
    return [
      {
        id: 'growth',
        label: 'GROWTH',
        items: [
          { href: '/editorial', icon: 'dashboard', label: 'Dashboard', exact: true },
          { href: '/editorial/analytics', icon: 'analytics', label: 'Analytics' },
          { href: '/editorial/growth/subscribers', icon: 'subscribers', label: 'Subscribers', exact: true },
          { href: '/editorial/growth/engagement', icon: 'engagement', label: 'Engagement', exact: true },
          { href: '/editorial/team-profile', icon: 'profile', label: 'Team Profile', exact: true },
        ],
      },
    ]
  }

  const groups: NavGroupSpec[] = [
    {
      id: 'overview',
      items: [
        { href: '/editorial', icon: 'dashboard', label: 'Dashboard', exact: true },
        ...(canEditOwnProfile ? [{ href: '/editorial/team-profile', icon: 'profile' as const, label: 'Team Profile', exact: true }] : []),
      ],
    },
    {
      id: 'content',
      label: 'CONTENT',
      items: [
        { href: '/editorial/recovery', icon: 'file', label: 'Local draft recovery' },
        { href: '/editorial/articles', icon: 'file', label: role === 'WRITER' ? 'My Articles' : 'All Articles' },
        { href: '/editorial/articles?mine=true&status=DRAFT', icon: 'pencil', label: 'My Drafts', exact: true },
        { href: '/editorial/articles/new', icon: 'plus', label: 'New Article', exact: true },
        ...(isEditor
          ? [
              { href: '/editorial/debates', icon: 'debates' as const, label: 'Debates' },
              { href: '/editorial/series', icon: 'series' as const, label: 'Article Series' },
              { href: '/editorial/scheduled', icon: 'clock' as const, label: 'Scheduled' },
            ]
          : []),
        ...(isAllowedRole(role, CALENDAR_ACCESS_ROLES) ? [{ href: '/editorial/calendar', icon: 'calendar' as const, label: 'Calendar' }] : []),
        ...(isEditor
          ? [{ href: '/editorial/trash', icon: 'trash' as const, label: 'Trash', exact: true, ...(trashCount > 0 ? { badge: trashCount } : {}) }]
          : []),
      ],
    },
  ]

  if (isEditor) {
    groups.push({
      id: 'review',
      label: 'REVIEW',
      items: [
        { href: '/editorial/review', icon: 'review', label: 'Review Queue' },
        { href: '/editorial/comments', icon: 'comments', label: 'Comments' },
      ],
    })
    groups.push({
      id: 'people',
      label: 'PEOPLE & AUDIENCE',
      items: [
        ...(isAdmin
          ? [
              { href: '/editorial/members', icon: 'members' as const, label: 'Team Members' },
              { href: '/editorial/users', icon: 'users' as const, label: 'Users' },
            ]
          : []),
        { href: '/admin/subscribers', icon: 'mail', label: 'Subscribers' },
      ],
    })
  }

  const insights: NavItemSpec[] = [
    ...(isAdmin ? [{ href: '/editorial/analytics', icon: 'analytics' as const, label: 'Analytics' }] : []),
    { href: '/editorial/readers', icon: 'readers', label: 'Your Readers' },
    ...(isAllowedRole(role, PREDICTIONS_MANAGE_ROLES) ? [{ href: '/editorial/predictions', icon: 'target' as const, label: 'Predictions' }] : []),
    ...(isAllowedRole(role, GLOSSARY_MANAGE_ROLES) ? [{ href: '/editorial/glossary', icon: 'glossary' as const, label: 'Glossary' }] : []),
    ...(role === 'WRITER' ? [{ href: '/editorial/leaderboard', icon: 'trophy' as const, label: 'Leaderboard', exact: true }] : []),
  ]
  groups.push({ id: 'insights', label: 'INSIGHTS', items: insights })

  if (isAdmin) {
    groups.push({
      id: 'administration',
      label: 'ADMINISTRATION',
      items: [
        { href: '/admin/login-attempts', icon: 'shield', label: 'Login Attempts' },
        { href: '/admin/data', icon: 'database', label: 'Data Management' },
      ],
    })
    groups.push({
      id: 'testing',
      label: 'TESTING',
      items: [{ href: '/admin/testing', icon: 'flask', label: 'Testing' }],
    })
  }

  return groups
}

/** Every href offered to a role, flattened. Handy for tests and for "is this link ours?" checks. */
export function navHrefs(input: NavInput): string[] {
  return buildNav(input).flatMap((g) => g.items.map((i) => i.href))
}
