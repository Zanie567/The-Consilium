'use client'

import { useCallback, useState } from 'react'
import Image from 'next/image'
import { Mail } from 'lucide-react'
import { getInitials } from '@/lib/authorUtils'
import { hasDisplayableRole, type TeamCardVariant } from '@/lib/teamHierarchy'
import { TeamMemberDialog } from '@/components/team/TeamMemberDialog'

export interface TeamCardMember {
  id: string
  name: string
  role: string | null
  /**
   * The person's own bio when their team email matches a registered account
   * (they maintain it at /profile?tab=account), otherwise the admin-entered one
   * from /admin/team. Resolved in `resolveTeamMemberBios`.
   */
  bio: string | null
  image: string | null
  email: string | null
  /** Author-page slug, present only when a matching account exists. */
  authorSlug: string | null
}

interface TeamMemberCardProps {
  member: TeamCardMember
  variant: TeamCardVariant
}

/**
 * Card prominence per masthead tier. Widths are `sm:` upwards only — every
 * variant is full-width on a phone so the masthead reads as a single column.
 */
const VARIANT = {
  lead: {
    card: 'w-full sm:w-[26rem] px-8 py-9',
    photo: 128,
    photoClass: 'w-32 h-32 mb-5',
    initials: 'text-3xl',
    name: 'text-2xl sm:text-[1.7rem]',
    role: 'text-[0.72rem] tracking-[0.24em] mt-2',
    bio: 'text-[0.95rem] mt-4',
  },
  feature: {
    card: 'w-full sm:w-[19rem] px-6 py-7',
    photo: 96,
    photoClass: 'w-24 h-24 mb-4',
    initials: 'text-2xl',
    name: 'text-xl',
    role: 'text-[0.68rem] tracking-[0.2em] mt-1.5',
    bio: 'text-sm mt-3',
  },
  standard: {
    card: 'w-full sm:w-[16.5rem] px-5 py-6',
    photo: 80,
    photoClass: 'w-20 h-20 mb-3.5',
    initials: 'text-xl',
    name: 'text-lg',
    role: 'text-[0.66rem] tracking-[0.18em] mt-1.5',
    bio: 'text-sm mt-3',
  },
  compact: {
    card: 'w-full sm:w-[14rem] px-4 py-5',
    photo: 64,
    photoClass: 'w-16 h-16 mb-3',
    initials: 'text-lg',
    name: 'text-base',
    role: 'text-[0.62rem] tracking-[0.16em] mt-1',
    bio: 'text-[0.8rem] mt-2.5',
  },
} as const satisfies Record<TeamCardVariant, unknown>

export function TeamMemberCard({ member, variant }: TeamMemberCardProps) {
  const style = VARIANT[variant]
  const [open, setOpen] = useState(false)
  // Stable identity: the dialog's open effect depends on it, and a new function
  // each render would tear down and re-run that effect (re-capturing the body's
  // overflow as 'hidden' and leaving the page unscrollable after close).
  const closeDialog = useCallback(() => setOpen(false), [])

  return (
    <>
      <div
        className={`${style.card} group relative h-full bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col items-center justify-center text-center transition-colors duration-300 hover:border-gold/40 focus-within:border-gold/40`}
      >
        {/* The whole card opens the profile. An overlay button (rather than
            wrapping everything) keeps the email link below independently
            clickable — nesting an anchor inside a button is invalid markup. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`View full profile for ${member.name}`}
          className="absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        />

        {/* `pointer-events-none`: this wrapper is positioned, so it paints above
            the overlay button and would otherwise swallow clicks on the photo —
            the most natural place to click on the card. */}
        <div
          className={`${style.photoClass} pointer-events-none relative shrink-0 overflow-hidden rounded-full bg-navy`}
        >
          {member.image ? (
            <Image
              src={member.image}
              alt={`${member.name}, ${hasDisplayableRole(member.role) ? member.role : 'The Consilium'}`}
              width={style.photo}
              height={style.photo}
              className="w-full h-full object-cover"
            />
          ) : (
            <span
              className={`${style.initials} absolute inset-0 flex items-center justify-center font-bold text-gold`}
              style={{ fontFamily: 'var(--font-serif)' }}
              aria-hidden="true"
            >
              {getInitials(member.name)}
            </span>
          )}
        </div>

        <h3
          className={`${style.name} font-bold text-[var(--fg)] leading-snug`}
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {member.name}
        </h3>

        {/* Roles are free text and may be absent; nothing is rendered in that
            case — no placeholder, no reserved space. */}
        {hasDisplayableRole(member.role) && (
          <p className={`${style.role} font-bold uppercase text-gold`}>{member.role}</p>
        )}

        {member.bio && (
          /* Clamped on the card; the dialog shows it in full. */
          <p className={`${style.bio} text-[var(--fg-muted)] leading-relaxed line-clamp-3`}>
            {member.bio}
          </p>
        )}

        {/* Always visible, not hover-only: on a touch screen there is no hover,
            and without it nothing signals that the card opens a profile. */}
        <span
          aria-hidden="true"
          className="mt-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold/55 transition-colors duration-200 group-hover:text-gold group-focus-within:text-gold"
        >
          {member.bio ? 'Read more' : 'View profile'}
        </span>

        {member.email && (
          <a
            href={`mailto:${member.email}`}
            className="relative z-10 mt-4 inline-flex max-w-full items-center gap-2 break-all text-xs text-[var(--fg-faint)] transition-colors hover:text-gold"
          >
            <Mail size={14} className="shrink-0" aria-hidden="true" />
            {member.email}
          </a>
        )}
      </div>

      <TeamMemberDialog member={member} open={open} onClose={closeDialog} />
    </>
  )
}
