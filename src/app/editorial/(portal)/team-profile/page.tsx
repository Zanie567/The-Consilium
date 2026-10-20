import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MAX_BIO_LENGTH, MAX_TEAM_PHOTO_BYTES } from '@/lib/constants'
import { assessProfile, defaultPublicAppointment, publicAppointmentLabel } from '@/lib/teamProfiles'
import { matchLegacyCard } from '@/lib/teamProfileLegacy'
import { pickShared, previewPublicProfile, profileEditorState, sharedProfileView } from '@/lib/profileFields'
import { TeamProfileForm } from '@/components/editorial/TeamProfileForm'
import { TeamProfileStatus } from '@/components/editorial/TeamProfileStatus'
import { LinkedProfileBanner } from '@/components/profile/SharedProfileNotices'

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
      bio: true,
      image: true,
      isActive: true,
      isBanned: true,
      displayTitles: true,
      teamProfile: { select: { name: true, bio: true, image: true, role: true, publicTier: true, isActive: true } },
    },
  })

  const appointment = account?.teamProfile ?? defaultPublicAppointment(account?.role ?? "")
  const name = account?.name?.trim()

  // Someone who already has a card from before accounts were linked must edit it,
  // not create a second one: an unambiguous match is adopted on first save (so the
  // page shows it as theirs), anything doubtful is held for an admin to link.
  const legacy =
    account && account.role !== 'ADMIN' && appointment && name && !account.teamProfile
      ? await matchLegacyCard(prisma, { name, email: account.email })
      : { kind: 'none' as const }
  const profile = account?.teamProfile ?? (legacy.kind === 'adoptable' ? legacy.card : null)
  const label = publicAppointmentLabel(profile ?? appointment ?? {})
  const card = account?.teamProfile ?? null
  const displayName = card?.name?.trim() || name || ''
  const assessment = assessProfile({
    name: displayName,
    bio: card?.bio,
    image: card?.image,
    position: card?.role,
    visible: card?.isActive ?? false,
  })

  // The details the form starts from, shared with the account page:
  //  - an existing card: the card (the account page shows the same);
  //  - a legacy card about to be adopted: that card, as it will be after adoption;
  //  - no card yet: the account's own details, which a new card starts from (so nothing written on
  //    the account page is lost).
  const editor = account ? profileEditorState(account, card, { testingMode: process.env.TESTING_MODE_ENABLED === '1' }) : null
  const view = account && !card && legacy.kind === 'adoptable'
    ? sharedProfileView(
        pickShared(account),
        // Adoption gives the card the account name, as it always has; bio and photo are the card's.
        pickShared({ name: displayName, bio: legacy.card.bio, image: legacy.card.image }),
        true,
      )
    : editor?.view
  const published = editor ? previewPublicProfile({ view: editor.view, card: editor.card, pending: {} }).teamCard?.onPublicPage ?? false : false

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold">Meet the Team</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>
        {profile ? 'Edit your team profile' : 'Create your team profile'}
      </h1>

      {!account || !appointment || !view ? (
        <p role="alert" className="mt-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--fg-muted)]">
          Your account has no assigned public appointment. Ask an administrator to assign and link your existing card.
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
          <div className="mt-6">
            {card ? (
              <LinkedProfileBanner where="team-profile" published={published} />
            ) : (
              <p className="border-l-2 border-gold pl-3 text-sm text-[var(--fg-muted)]">
                Your new profile starts from the name, photo and biography on your account, and stays hidden until an
                administrator publishes it. Saving it also updates your account, so both always match.
              </p>
            )}
          </div>
          <TeamProfileStatus assessment={assessment} />
          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6">
            <TeamProfileForm
              view={view}
              exists={profile !== null}
              fallbackName={displayName}
              positionLabel={label}
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
