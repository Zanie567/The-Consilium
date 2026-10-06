import { prisma } from '@/lib/prisma'
import { buildPublicRoster, teamMemberEmails } from '@/lib/teamProfiles'

export async function loadPublicTeam() {
  try {
    const rows = await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: {
        user: {
          select: {
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
            select: { email: true, bio: true, slug: true },
          })

    return buildPublicRoster(rows, accounts)
  } catch (error) {
    console.error('[team] roster unavailable', error)
    throw new Error('The team roster is unavailable. Check the deployment schema.')
  }
}
