import Image from 'next/image'
import { getInitials } from '@/lib/authorUtils'
import { resolvePublicTitleLabel } from '@/lib/displayTitles'

interface Props {
  name: string
  bio: string
  image: string | null
  titles: string[]
  /** Label shown when no titles are chosen: the team card title or role label. */
  fallbackLabel: string | null
}

/**
 * A live approximation of the public author page header (/author/[slug]) for the
 * values currently in the form. Text is rendered through React, never as HTML.
 */
export function ProfilePreview({ name, bio, image, titles, fallbackLabel }: Props) {
  const label =
    resolvePublicTitleLabel({ displayTitles: titles, cardTitle: fallbackLabel }) ?? 'Contributor'
  const shownName = name.trim() || 'Your name'

  return (
    <div aria-label="Preview of your public profile" role="group" className="border border-gold/25 bg-navy p-5 sm:p-6">
      <p className="mb-4 text-[0.6rem] font-bold uppercase tracking-[0.3em] text-cream/40">
        Public preview
      </p>
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        {image ? (
          <Image
            src={image}
            alt=""
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-gold/40"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gold/20 ring-2 ring-gold/40">
            <span className="text-2xl font-bold text-gold" style={{ fontFamily: 'var(--font-serif)' }}>
              {getInitials(shownName)}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-[0.25em] text-gold/70 [overflow-wrap:anywhere]">
            {label}
          </p>
          <p
            className="mb-2 text-2xl font-bold leading-tight text-cream [overflow-wrap:anywhere]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {shownName}
          </p>
          {bio.trim() && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-cream/65 [overflow-wrap:anywhere]">
              {bio.trim()}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
