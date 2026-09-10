import Image from 'next/image'
import { Mail } from 'lucide-react'
import { getInitials } from '@/lib/authorUtils'
import { hasDisplayableRole, type TeamCardVariant } from '@/lib/teamHierarchy'

interface TeamMemberCardProps {
  member: {
    name: string
    role: string | null
    bio: string | null
    image: string | null
    email: string | null
  }
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

  return (
    <div
      className={`${style.card} h-full bg-[var(--bg-elevated)] border border-[var(--border)] flex flex-col items-center justify-center text-center transition-colors duration-300 hover:border-gold/40`}
    >
      <div
        className={`${style.photoClass} relative shrink-0 overflow-hidden rounded-full bg-navy`}
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
        <p className={`${style.bio} text-[var(--fg-muted)] leading-relaxed`}>{member.bio}</p>
      )}

      {member.email && (
        <a
          href={`mailto:${member.email}`}
          className="mt-4 inline-flex max-w-full items-center gap-2 break-all text-xs text-[var(--fg-faint)] transition-colors hover:text-gold"
        >
          <Mail size={14} className="shrink-0" aria-hidden="true" />
          {member.email}
        </a>
      )}
    </div>
  )
}
