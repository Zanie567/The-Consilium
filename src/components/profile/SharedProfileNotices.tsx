'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Link2 } from 'lucide-react'
import type { SharedField, SharedProfileView } from '@/lib/profileFields'

/**
 * The banner that tells a contributor their account details and their Meet the Team profile are one
 * profile: whichever screen they edit, the same name, photo and biography appear everywhere.
 */
export function LinkedProfileBanner({
  where,
  published,
}: {
  /** The screen the banner is on; the link points at the other one. */
  where: 'account' | 'team-profile'
  /** Whether readers can see the Our Team card now. */
  published: boolean
}) {
  return (
    <div className="border border-gold/40 bg-navy p-4 sm:p-5 text-cream" data-testid="linked-profile-banner">
      <div className="flex items-start gap-3">
        <Link2 size={18} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-bold uppercase tracking-widest text-gold">One profile, everywhere</p>
          <p className="text-sm leading-relaxed text-cream/80">
            Your name, photo and biography {where === 'account' ? 'here' : 'on this page'} are the same ones used on the
            Our Team page, your author page and under your articles. Saving them {where === 'account' ? 'here' : 'on this page'} or{' '}
            {where === 'account' ? 'in your editorial Team Profile' : 'on your account page'} updates all of them.
          </p>
          <p className="text-xs text-cream/55">
            {published
              ? 'Your team profile is published on the Our Team page.'
              : 'Your team profile is hidden: it is not on the Our Team page. Only an administrator can publish it.'}{' '}
            Your public title, placement and access role are managed by an administrator and are not changed here.
          </p>
          <Link
            href={where === 'account' ? '/editorial/team-profile' : '/profile?tab=settings'}
            className="inline-flex min-h-[40px] items-center gap-2 border border-gold/50 px-4 text-xs font-bold uppercase tracking-widest text-gold transition-colors hover:bg-gold hover:text-navy"
          >
            {where === 'account' ? 'Open your Team Profile' : 'Open your account page'}
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}

const LABEL: Record<SharedField, string> = { name: 'Name', bio: 'Biography', image: 'Photo' }

/**
 * Details entered separately before the two profiles were joined. Nothing is overwritten until the
 * person chooses, and each choice is saved at once (like a photo change): "Use this version" saves
 * the account's value to the team profile too; "Use … everywhere" saves the team profile's value to
 * the account too. Either way the value replaced is kept in the audit log.
 */
export function DifferingDetails({
  view,
  busy,
  onUseAccount,
  onUseShown,
}: {
  view: SharedProfileView
  busy: boolean
  onUseAccount: (field: SharedField, value: string | null) => void
  onUseShown: (field: SharedField) => void
}) {
  const fields = (Object.keys(view.accountDiffers) as SharedField[]).filter((field) => field in view.accountDiffers)
  if (!view.linked || fields.length === 0) return null
  return (
    <section
      aria-labelledby="differing-details-heading"
      className="border border-amber-500/40 bg-amber-500/5 p-4"
      data-testid="differing-details"
    >
      <h4 id="differing-details-heading" className="text-sm font-bold text-[var(--fg)]">
        Some details still differ between your account and your team profile
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">
        Before the two were joined, they could be edited separately. Nothing has been changed or deleted. The form shows your
        team profile&apos;s version; choose which one to keep and it will be used everywhere.
      </p>
      <ul className="mt-3 space-y-3">
        {fields.map((field) => {
          const accountValue = view.accountDiffers[field] ?? null
          const shownValue = view.values[field]
          return (
            <li key={field} className="border-t border-amber-500/20 pt-3" data-testid={`differs-${field}`}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">{LABEL[field]} under your articles</p>
              {field === 'image' ? (
                accountValue ? (
                  <Image src={accountValue} alt="Your account photo" width={48} height={48} className="mt-1 h-12 w-12 rounded-full object-cover" />
                ) : (
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">No photo (your initials are shown).</p>
                )
              ) : (
                <p className="mt-1 whitespace-pre-line text-sm text-[var(--fg)] [overflow-wrap:anywhere]">
                  {accountValue ?? <span className="text-[var(--fg-muted)]">None shown yet.</span>}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {accountValue !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUseAccount(field, accountValue)}
                    className="min-h-[36px] border border-[var(--border-strong)] px-3 text-[11px] font-bold uppercase tracking-widest text-[var(--fg)] hover:border-gold hover:text-gold disabled:opacity-60"
                  >
                    Use this version
                  </button>
                )}
                {shownValue !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUseShown(field)}
                    className="min-h-[36px] border border-[var(--border-strong)] px-3 text-[11px] font-bold uppercase tracking-widest text-[var(--fg)] hover:border-gold hover:text-gold disabled:opacity-60"
                  >
                    {field === 'image' ? 'Use your team photo everywhere' : `Use the team profile ${field === 'bio' ? 'biography' : 'name'} everywhere`}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
