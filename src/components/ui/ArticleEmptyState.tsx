import Link from 'next/link'
import { AnimateIn } from '@/components/ui/AnimateIn'
import type { SectionEmptyState } from '@/lib/sectionEmptyStates'

interface ArticleEmptyStateProps {
  state: SectionEmptyState
  /** Optional way out — "Back to Homepage", "Clear filters", … */
  action?: { href: string; label: string }
  className?: string
}

/**
 * The single empty state for every public article list. Extracted from the
 * category page, which was the only surface that had a considered one; the
 * homepage tabs, tag, author and archive pages previously showed a bare line of
 * faint text.
 *
 * Copy comes from `@/lib/sectionEmptyStates` so the wording for a given section
 * is identical wherever the reader hits it.
 */
export function ArticleEmptyState({ state, action, className = '' }: ArticleEmptyStateProps) {
  return (
    <AnimateIn variant="fade-up" className={className}>
      <div className="py-24 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-subtle)] flex items-center justify-center mb-6 border border-[var(--border)]">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gold/70"
            aria-hidden="true"
          >
            <path d={state.icon} />
          </svg>
        </div>
        <h2
          className="text-2xl font-bold text-[var(--fg)] mb-3"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {state.title}
        </h2>
        <p className="text-[var(--fg-muted)] text-sm leading-relaxed">{state.description}</p>
        {action && (
          <Link
            href={action.href}
            className="mt-8 inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-[-0.01em] border border-gold/50 px-6 py-3 hover:bg-gold hover:text-navy transition-all duration-150"
          >
            {action.label}
          </Link>
        )}
      </div>
    </AnimateIn>
  )
}
