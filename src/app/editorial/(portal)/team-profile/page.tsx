import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MAX_BIO_LENGTH, MAX_TEAM_PHOTO_BYTES } from '@/lib/constants'
import { TEAM_LABEL, teamForRole } from '@/lib/teamProfiles'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { TeamProfileForm } from '@/components/editorial/TeamProfileForm'

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
      teamProfile: { select: { bio: true, image: true } },
    },
  })

  const team = teamForRole(account?.role)
  const name = account?.name?.trim()

  // Someone who already has a card from before accounts were linked must edit it,
  // not create a second one: an unambiguous match is adopted on first save (so the
  // page shows it as theirs), anything doubtful is held for an admin to link.
  const legacy =
    account && team && name && !account.teamProfile
      ? await matchLegacyCard(prisma, { name, email: account.email })
      : { kind: 'none' as const }
  const profile = account?.teamProfile ?? (legacy.kind === 'adoptable' ? legacy.card : null)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold">Meet the Team</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        {profile ? 'Edit your team profile' : 'Create your team profile'}
      </h1>

      {!account || !team ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          Your account isn&apos;t assigned to the Writing, Editorial or Growth &amp; Communications team, so it
          has no Meet the Team profile. If that&apos;s a mistake, ask an administrator to check your role.
        </p>
      ) : !name ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          Add your name in your account settings first. Your team profile uses it.
        </p>
      ) : legacy.kind === 'blocked' ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          A team card for you already exists but isn&apos;t linked to your account yet. Ask an administrator to
          link it, so you edit that card instead of appearing on the Our Team page twice.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            This is the card readers see on the public Our Team page, under {TEAM_LABEL[team]}.
          </p>
          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6">
            <TeamProfileForm
              name={name}
              teamLabel={TEAM_LABEL[team]}
              profile={profile}
              maxBioLength={MAX_BIO_LENGTH}
              maxPhotoBytes={MAX_TEAM_PHOTO_BYTES}
            />
          </div>
        </>
      )}
    </div>
  )
}
