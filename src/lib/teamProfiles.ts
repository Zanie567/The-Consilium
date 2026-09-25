/**
 * Resolving a team member's bio against their own account.
 *
 * `TeamMember` (admin-managed, /admin/team) and `User` (the person's account) are
 * separate tables with no foreign key between them. They are matched on email, so
 * a person who edits their bio at /profile?tab=account sees that bio on their
 * Meet the Team card without an admin re-typing it.
 *
 * Precedence: the account bio wins when there is one; the admin-entered bio is the
 * fallback for members with no account, or whose account bio is empty. An admin
 * therefore keeps a working bio for every member, and a member can override their
 * own at any time.
 */

export interface TeamMemberRow {
  id: string
  name: string
  role: string
  bio: string | null
  image: string | null
  email: string | null
  /** Masthead sort position; carried through so `buildTeamMasthead` can tier. */
  order: number
}

export interface LinkedAccount {
  email: string
  bio: string | null
  slug: string | null
}

export interface ResolvedTeamMember extends Omit<TeamMemberRow, 'role'> {
  role: string | null
  authorSlug: string | null
}

/** Emails to look up for a set of team members, lower-cased and de-duplicated. */
export function teamMemberEmails(members: TeamMemberRow[]): string[] {
  const emails = members
    .map((member) => member.email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email))
  return [...new Set(emails)]
}

/**
 * Merges account data into team member rows.
 *
 * Matching is case-insensitive on email, because a team email entered in the
 * admin form ("J.Smith@ed.ac.uk") frequently differs in case from the one the
 * person signed up with.
 */
export function resolveTeamMemberBios(
  members: TeamMemberRow[],
  accounts: LinkedAccount[],
): ResolvedTeamMember[] {
  const byEmail = new Map(
    accounts.map((account) => [account.email.trim().toLowerCase(), account]),
  )

  return members.map((member) => {
    const key = member.email?.trim().toLowerCase()
    const account = key ? byEmail.get(key) : undefined
    // An account with a blank bio falls back to the admin-entered one rather than
    // blanking the card — an empty self-bio is an absence, not a deletion.
    const accountBio = account?.bio?.trim() || null

    return {
      ...member,
      bio: accountBio ?? member.bio,
      authorSlug: account?.slug ?? null,
    }
  })
}
