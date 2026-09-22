'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Mail, X } from 'lucide-react'
import { getInitials } from '@/lib/authorUtils'
import { hasDisplayableRole } from '@/lib/teamHierarchy'
import type { TeamCardMember } from '@/components/team/TeamMemberCard'

interface TeamMemberDialogProps {
  member: TeamCardMember
  open: boolean
  onClose: () => void
}

/** Elements inside the dialog that can hold focus, for the tab trap. */
const FOCUSABLE = 'a[href], button:not([disabled])'

/**
 * The expanded profile shown when a team member's card is clicked: the full bio
 * at a readable size, plus their role, email and author page.
 *
 * Closing: the close button, the backdrop, or Escape. Focus moves into the dialog
 * on open, is trapped while it is open, and returns to the card that opened it on
 * close, so keyboard users are never dropped at the top of the page.
 */
export function TeamMemberDialog({ member, open, onClose }: TeamMemberDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // The element that had focus before the dialog opened, restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // `open` is the ONLY dependency of the effect below. If `onClose` were a
  // dependency, a caller passing an inline arrow (a new function each render)
  // would make the effect tear down and re-run while the dialog is open — and the
  // re-run would capture the body overflow as 'hidden', leaving the page
  // permanently unscrollable once the dialog closed.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current = document.activeElement as HTMLElement | null

    // Lock background scrolling while the dialog is over the page.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    // Focus the panel itself rather than the close button, so a screen reader
    // announces the person's name before offering "close".
    panelRef.current?.focus()

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  const headingId = `team-member-${member.id}`

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-navy/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-[0_24px_70px_rgba(0,0,0,0.45)] outline-none"
          >
            {/* Gold masthead rule, matching the site's other elevated surfaces */}
            <div className="h-[2px] bg-gradient-to-r from-gold/30 via-gold to-gold/30" />

            <button
              type="button"
              onClick={onClose}
              aria-label={`Close profile for ${member.name}`}
              className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center text-[var(--fg-faint)] hover:text-gold transition-colors"
            >
              <X size={18} aria-hidden="true" />
            </button>

            <div className="px-6 sm:px-9 pt-9 pb-8 flex flex-col items-center text-center">
              <div className="relative mb-5 h-28 w-28 shrink-0 overflow-hidden rounded-full bg-navy">
                {member.image ? (
                  <Image
                    src={member.image}
                    alt=""
                    width={112}
                    height={112}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-gold"
                    style={{ fontFamily: 'var(--font-serif)' }}
                    aria-hidden="true"
                  >
                    {getInitials(member.name)}
                  </span>
                )}
              </div>

              <h2
                id={headingId}
                className="text-2xl sm:text-[1.7rem] font-bold text-[var(--fg)] leading-snug"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {member.name}
              </h2>

              {hasDisplayableRole(member.role) && (
                <p className="mt-2 text-[0.72rem] font-bold uppercase tracking-[0.24em] text-gold">
                  {member.role}
                </p>
              )}

              <span aria-hidden="true" className="my-6 h-px w-16 bg-[var(--border-strong)]" />

              {member.bio ? (
                // The bio is the point of the dialog: full text, left-aligned and
                // a step larger than the card, with paragraph breaks preserved.
                <p className="text-left text-[0.95rem] leading-relaxed text-[var(--fg-muted)] whitespace-pre-line">
                  {member.bio}
                </p>
              ) : (
                <p className="text-sm italic text-[var(--fg-faint)]">
                  This member has not written a bio yet.
                </p>
              )}

              {(member.email || member.authorSlug) && (
                <div className="mt-8 flex flex-col items-center gap-3">
                  {member.authorSlug && (
                    <Link
                      href={`/author/${member.authorSlug}`}
                      className="inline-flex items-center gap-2 border border-gold/50 px-6 py-3 text-xs font-bold uppercase tracking-[-0.01em] text-gold transition-all duration-150 hover:bg-gold hover:text-navy"
                    >
                      Read their articles →
                    </Link>
                  )}
                  {member.email && (
                    <a
                      href={`mailto:${member.email}`}
                      className="inline-flex max-w-full items-center gap-2 break-all text-xs text-[var(--fg-faint)] transition-colors hover:text-gold"
                    >
                      <Mail size={14} className="shrink-0" aria-hidden="true" />
                      {member.email}
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
