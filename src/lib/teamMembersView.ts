/**
 * Pure view logic for the Team Members screen: what counts as "needs a public profile",
 * the filters, search and sort, and the counts shown above the table. No React, no database.
 */
import type { MemberRow } from '@/lib/membership'

export type MemberFilter = 'all' | 'needs-profile' | 'published' | 'hidden' | 'invited' | 'revoked'
export type MemberSort = 'recent' | 'name' | 'position' | 'role'

export const MEMBER_FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-profile', label: 'Needs profile' },
  { value: 'published', label: 'Public' },
  { value: 'hidden', label: 'Not public' },
  { value: 'invited', label: 'Invited' },
  { value: 'revoked', label: 'Revoked' },
]

export const NEW_ACCOUNT_DAYS = 14

/** A real account with team access and no Meet the Team profile at all. */
export function needsProfile(row: MemberRow): boolean {
  return row.userId !== null && row.card === null && row.accountStatus !== 'revoked' && row.accountStatus !== 'suspended'
}

/** Created recently and still without a profile: the ones an administrator should see first. */
export function isNewWithoutProfile(row: MemberRow, now: Date = new Date()): boolean {
  if (!needsProfile(row) || !row.accountCreatedAt) return false
  return now.getTime() - new Date(row.accountCreatedAt).getTime() <= NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000
}

export function filterMembers(rows: MemberRow[], { query, filter }: { query: string; filter: MemberFilter }): MemberRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    switch (filter) {
      case 'needs-profile': if (!needsProfile(row)) return false; break
      case 'published': if (row.profileStatus !== 'published') return false; break
      case 'hidden': if (row.card === null || row.profileStatus === 'published') return false; break
      case 'invited': if (row.accountStatus !== 'invited' && row.accountStatus !== 'unverified') return false; break
      case 'revoked': if (row.accountStatus !== 'revoked') return false; break
    }
    if (!needle) return true
    return [row.name ?? '', row.email, row.position ?? '', row.role, row.card?.name ?? '']
      .join('\n')
      .toLowerCase()
      .includes(needle)
  })
}

const ROLE_RANK: Record<string, number> = { ADMIN: 0, EDITOR: 1, WRITER: 2, GROWTH: 3, READER: 4 }
const byName = (a: MemberRow, b: MemberRow) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'en', { sensitivity: 'base' })

export function sortMembers(rows: MemberRow[], sort: MemberSort): MemberRow[] {
  const copy = [...rows]
  switch (sort) {
    case 'name': return copy.sort(byName)
    case 'position': return copy.sort((a, b) => (a.position ?? '￿').localeCompare(b.position ?? '￿', 'en', { sensitivity: 'base' }) || byName(a, b))
    case 'role': return copy.sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || byName(a, b))
    case 'recent':
    default: {
      const stamp = (r: MemberRow) => r.accountCreatedAt ?? r.createdAt
      return copy.sort((a, b) => stamp(b).localeCompare(stamp(a)) || byName(a, b))
    }
  }
}

export interface MemberSummary {
  total: number
  needProfile: number
  publicProfiles: number
  notPublic: number
  pendingInvites: number
}

export function summariseMembers(rows: MemberRow[]): MemberSummary {
  return {
    total: rows.length,
    needProfile: rows.filter(needsProfile).length,
    publicProfiles: rows.filter((r) => r.profileStatus === 'published').length,
    notPublic: rows.filter((r) => r.card !== null && r.profileStatus !== 'published').length,
    pendingInvites: rows.filter((r) => r.accountStatus === 'invited' || r.accountStatus === 'unverified').length,
  }
}
