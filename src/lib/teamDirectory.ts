/**
 * Everything the administrator's Team Members screen needs in one read: the people (with their
 * account, permission role and linked card), the cards that have no owner yet, recent sign-ups
 * who are not members, and the consistency findings. Read-only.
 */
import { prisma } from '@/lib/prisma'
import { listMembers, normalizeEmail, type MemberRow } from '@/lib/membership'
import { buildReconciliationReport, type ReconciliationIssue } from '@/lib/teamReconciliation'
import { suggestCards, type CardSuggestion } from '@/lib/teamCards'

export interface UnlinkedCardRow {
  id: string
  name: string
  position: string
  publicTier: string | null
  bio: string | null
  image: string | null
  email: string | null
  order: number
  visible: boolean
  updatedAt: string
}

export interface RecentSignup {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  createdAt: string
  /** Existing unlinked cards that might be theirs, once they are authorised. Hints only. */
  suggestions: CardSuggestion[]
}

export interface TeamDirectory {
  members: MemberRow[]
  unlinkedCards: UnlinkedCardRow[]
  recentSignups: RecentSignup[]
  issues: ReconciliationIssue[]
}

const RECENT_SIGNUP_DAYS = 30
const RECENT_SIGNUP_LIMIT = 25

export async function loadTeamDirectory(client: typeof prisma = prisma, now: Date = new Date()): Promise<TeamDirectory> {
  const since = new Date(now.getTime() - RECENT_SIGNUP_DAYS * 24 * 60 * 60 * 1000)
  const [members, cards, accounts, memberships, signups] = await Promise.all([
    listMembers(client),
    client.teamMember.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    client.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, isBanned: true },
      // Staff, plus anyone a card's email points at (a reader who has not been authorised yet).
      where: { role: { not: 'READER' } },
    }),
    client.teamMembership.findMany({ select: { id: true, email: true, role: true, status: true, userId: true } }),
    client.user.findMany({
      where: { role: 'READER', membership: null, createdAt: { gte: since }, isActive: true, isBanned: false },
      select: { id: true, email: true, name: true, emailVerified: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SIGNUP_LIMIT,
    }),
  ])

  const unlinked = cards.filter((c) => !c.userId)
  const cardEmails = unlinked.map((c) => c.email?.trim()).filter((e): e is string => Boolean(e))
  const readersByCardEmail = cardEmails.length
    ? await client.user.findMany({
        where: { role: 'READER', OR: cardEmails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
        select: { id: true, email: true, name: true, role: true, isActive: true, isBanned: true },
      })
    : []

  const issues = buildReconciliationReport({
    accounts: [...accounts, ...readersByCardEmail],
    cards: cards.map((c) => ({
      id: c.id, name: c.name, position: c.role, email: c.email, userId: c.userId, visible: c.isActive,
    })),
    memberships: memberships.map((m) => ({ ...m })),
  })

  return {
    members,
    unlinkedCards: unlinked.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.role,
      publicTier: c.publicTier,
      bio: c.bio,
      image: c.image,
      email: c.email,
      order: c.order,
      visible: c.isActive,
      updatedAt: c.updatedAt.toISOString(),
    })),
    recentSignups: signups.map((u) => ({
      id: u.id,
      email: normalizeEmail(u.email),
      name: u.name,
      emailVerified: Boolean(u.emailVerified),
      createdAt: u.createdAt.toISOString(),
      suggestions: suggestCards(u, unlinked.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email }))),
    })),
    issues,
  }
}
