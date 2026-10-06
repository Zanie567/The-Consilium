import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MAX_BIO_LENGTH, MAX_TEAM_PHOTO_BYTES } from '@/lib/constants'
import {
  TEAM_LABEL,
  TEAM_PROFILE_OWNER_ROLES,
  assessProfile,
  resolveCardTeam,
} from '@/lib/teamProfiles'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { TeamProfileForm } from '@/components/editorial/TeamProfileForm'
import { TeamProfileStatus } from '@/components/editorial/TeamProfileStatus'

export const metadata: Metadata = {
  title: 'Team profile | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function TeamProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/editorial/login')

  // Role and ownership are read from the database for the session's own id —
  // never from the JWT, and never from a URL or query parameter.
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      role: true,
      teamProfile: { select: { name: true, bio: true, image: true, role: true, team: true, isActive: true } },
    },
  })

  const eligible = !!account && (TEAM_PROFILE_OWNER_ROLES as readonly string[]).includes(account.role)
  const accountName = account?.name?.trim() ?? ''

  // Someone who already has a card from before accounts were linked must edit it,
  // not create a second one: an unambiguous match is adopted on first save (so the
  // page shows it as theirs), anything doubtful is held for an admin to link.
  const legacy =
    account && eligible && accountName && !account.teamProfile
      ? await matchLegacyCard(prisma, { name: accountName, email: account.email })
      : { kind: 'none' as const }
  const card = account?.teamProfile ?? null
  const profile = card ?? (legacy.kind === 'adoptable' ? { ...legacy.card, name: accountName } : null)

  const team = account ? resolveCardTeam(card?.team, account.role) : null
  const displayName = card?.name?.trim() || accountName
  const assessment = assessProfile({
    name: displayName,
    bio: card?.bio,
    image: card?.image,
    position: card?.role,
    team,
    visible: card?.isActive ?? false,
  })

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold">Meet the Team</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        {profile ? 'Edit your team profile' : 'Create your team profile'}
      </h1>

      {!account || !eligible ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          Your account doesn&apos;t have a Meet the Team profile. If that&apos;s a mistake, ask an administrator to
          check your access.
        </p>
      ) : legacy.kind === 'blocked' ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          A team card for you already exists but isn&apos;t linked to your account yet. Ask an administrator to
          link it, so you edit that card instead of appearing on the Our Team page twice.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            This is the card readers see on the public Our Team page. Adding it is optional, and you can change
            your name, photo and description at any time.
          </p>
          <TeamProfileStatus assessment={assessment} />
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6">
            <TeamProfileForm
              name={displayName}
              teamLabel={team ? TEAM_LABEL[team] : null}
              position={card?.role?.trim() || null}
              profile={profile}
              maxNameLength={100}
              maxBioLength={MAX_BIO_LENGTH}
              maxPhotoBytes={MAX_TEAM_PHOTO_BYTES}
            />
          </div>
        </>
      )}
    </div>
  )
}
