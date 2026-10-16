import { prisma } from '@/lib/prisma'
import { publishedArticleWhere } from '@/lib/articleQueries'
import {
  attachAuthorPages,
  buildPublicRoster,
  rosterAuthorIds,
  teamMemberEmails,
  type PublicRosterMember,
} from '@/lib/teamProfiles'

export async function loadPublicTeam(): Promise<PublicRosterMember[]> {
  try {
    const rows = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            displayTitles: true,
            bio: true,
            slug: true,
            isActive: true,
            isBanned: true,
          },
        },
      },
    })

    // Legacy cards (no linked account) still prefer the person's self-maintained
    // account bio, matched on email. Schema/database failures surface visibly.
    const emails = teamMemberEmails(rows.filter((row) => !row.user))
    const accounts =
      emails.length === 0
        ? []
        : await prisma.user.findMany({
            // Matched case-insensitively per address, NOT `email: { in: emails }` —
            // Postgres compares that exactly, so an account stored as
            // "J.Smith@ed.ac.uk" would never match the lower-cased team email.
            where: {
              OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
              // Banned or deactivated accounts keep the admin-entered bio:
              // self-authored text from a suspended account must not surface.
              isActive: true,
              isBanned: false,
            },
            // teamProfile (any visibility) withholds a legacy card's author link: that
            // person's authorship belongs to their own card, shown or hidden.
            select: { id: true, email: true, bio: true, slug: true, teamProfile: { select: { id: true } } },
          })

    const roster = buildPublicRoster(rows, accounts)

    // "Read their articles" follows published authorship, never role or title: one query
    // for every attributed account, using the same visibility rule as the author page.
    // A failure here fails the roster like any other, rather than hiding everyone's link.
    const authorIds = rosterAuthorIds(roster)
    const published =
      authorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: authorIds }, articles: { some: publishedArticleWhere() } },
            select: { id: true },
          })

    return attachAuthorPages(roster, new Set(published.map((account) => account.id)))
  } catch (error) {
    console.error('[team] roster unavailable', error)
    throw new Error('The team roster is unavailable. Check the deployment schema.')
  }
}
