import Image from 'next/image'
import { getInitials } from '@/lib/authorUtils'
import { resolvePublicTitleLabel } from '@/lib/displayTitles'
import type { PublicPreview } from '@/lib/profileFields'

interface Props {
  /** What the public pages will show, from previewPublicProfile (the same rules the pages use). */
  preview: PublicPreview
  titles: string[]
  /** Label shown when no titles are chosen: the team card title or role label. */
  fallbackLabel: string | null
  /** The form has changes that are not saved yet. */
  unsaved: boolean
}

function Avatar({ image, name, size }: { image: string | null; name: string; size: 'lg' | 'sm' }) {
  const box = size === 'lg' ? 'h-20 w-20' : 'h-14 w-14'
  return image ? (
    <Image
      src={image}
      alt=""
      width={size === 'lg' ? 80 : 56}
      height={size === 'lg' ? 80 : 56}
      className={`${box} shrink-0 rounded-full object-cover ring-2 ring-gold/40`}
    />
  ) : (
    <div className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-gold/20 ring-2 ring-gold/40`}>
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-lg'} font-bold text-gold`} style={{ fontFamily: 'var(--font-serif)' }}>
        {getInitials(name)}
      </span>
    </div>
  )
}

/**
 * The public author page header (/author/[slug]) and, for a contributor with a team profile, their
 * Our Team card, as they will look once the form is saved. Text is rendered through React, never
 * as HTML.
 */
export function ProfilePreview({ preview, titles, fallbackLabel, unsaved }: Props) {
  const label =
    resolvePublicTitleLabel({ displayTitles: titles, cardTitle: fallbackLabel }) ?? 'Contributor'
  const authorName = preview.author.name?.trim() || 'Your name'
  const status = unsaved ? 'Preview of unsaved changes' : 'As shown publicly now'
  const card = preview.teamCard

  return (
    <div aria-label="Preview of your public profile" role="group" className="space-y-4">
      <div className="border border-gold/25 bg-navy p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-cream/40">Author page</p>
          <p className={`text-[0.6rem] font-bold uppercase tracking-[0.2em] ${unsaved ? 'text-amber-300' : 'text-cream/40'}`} data-testid="preview-status">
            {status}
          </p>
        </div>
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          <Avatar image={preview.author.image} name={authorName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-[0.25em] text-gold/70 [overflow-wrap:anywhere]">
              {label}
            </p>
            <p
              className="mb-2 text-2xl font-bold leading-tight text-cream [overflow-wrap:anywhere]"
              style={{ fontFamily: 'var(--font-serif)' }}
              data-testid="preview-author-name"
            >
              {authorName}
            </p>
            {preview.author.bio && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-cream/65 [overflow-wrap:anywhere]" data-testid="preview-author-bio">
                {preview.author.bio}
              </p>
            )}
          </div>
        </div>
      </div>

      {card && (
        <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4" data-testid="preview-team-card">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[var(--fg-faint)]">Our Team card</p>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--fg-faint)]">
              {card.onPublicPage ? 'On the Our Team page' : 'Not on the Our Team page'}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Avatar image={card.image} name={card.name ?? 'Your name'} size="sm" />
            <div className="min-w-0">
              <p className="font-bold text-[var(--fg)] [overflow-wrap:anywhere]" style={{ fontFamily: 'var(--font-serif)' }}>
                {card.name ?? 'Your name'}
              </p>
              {card.positionLabel && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold">{card.positionLabel}</p>
              )}
              <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-[var(--fg-muted)] [overflow-wrap:anywhere]" data-testid="preview-team-bio">
                {card.bio ?? 'No biography: the card cannot appear without one.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
