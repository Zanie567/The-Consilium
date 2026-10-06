import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { TEAM_PROFILE_OWNER_ROLES, assessProfile, resolveCardTeam } from '@/lib/teamProfiles'

/**
 * Dashboard prompt for a team member whose Meet the Team card still needs something
 * only they can supply (name, photo, description). Renders nothing once those are
 * done, for readers, and if the lookup fails. Completing the card is optional.
 */
export async function TeamProfileNudge({ userId }: { userId: string }) {
  const account = await prisma.user
    .findUnique({
      where: { id: userId },
      select: {
        name: true,
        role: true,
        teamProfile: { select: { name: true, bio: true, image: true, role: true, team: true, isActive: true } },
      },
    })
    .catch(() => null)
  if (!account || !(TEAM_PROFILE_OWNER_ROLES as readonly string[]).includes(account.role)) return null

  const card = account.teamProfile
  const assessment = assessProfile({
    name: card?.name || account.name,
    bio: card?.bio,
    image: card?.image,
    position: card?.role,
    team: resolveCardTeam(card?.team, account.role),
    visible: card?.isActive ?? false,
  })
  if (assessment.missingFromMember.length === 0) return null

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-gold/40 bg-[var(--bg-elevated)] p-4 sm:mb-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-gold">Profile incomplete</p>
        <p className="mt-1 text-sm font-bold text-[var(--fg)]">Complete your team profile</p>
        <p className="mt-0.5 text-sm text-[var(--fg-muted)]">
          Add your photo and a short description for the Our Team page. It&apos;s optional, and takes a minute.
        </p>
      </div>
      <Link
        href="/editorial/team-profile"
        className="inline-flex min-h-[44px] items-center bg-navy px-5 text-xs font-bold uppercase tracking-widest text-cream hover:bg-navy/90"
      >
        Complete profile
      </Link>
    </div>
  )
}
