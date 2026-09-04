import Link from 'next/link'

/**
 * The honesty line under a translated article.
 *
 * Two states, both deliberately plain:
 *
 *   * `machine` — the reader is looking at output from an automatic translation
 *     service. The Consilium has no human translation workflow, so the notice
 *     says machine translation and points at the English original, which
 *     remains the canonical text. It is never dressed up as a reviewed
 *     translation.
 *   * `unavailable` — translation could not be produced. The English article is
 *     rendered untouched above this notice; nothing is blanked, half-translated
 *     or falsely presented as translated.
 */

interface Props {
  state: 'machine' | 'unavailable'
  /** English name of the language the reader asked for. */
  languageName: string
  slug: string
}

export function TranslationNotice({ state, languageName, slug }: Props) {
  if (state === 'unavailable') {
    return (
      <div
        role="status"
        className="no-print mb-8 border-l-[3px] border-[var(--border-strong)] bg-[var(--bg-subtle)] pl-4 py-3 text-sm text-[var(--fg-muted)]"
      >
        The {languageName} translation is temporarily unavailable. The original
        English article is shown below.
      </div>
    )
  }

  return (
    <div className="no-print mb-8 border-l-[3px] border-[var(--border-strong)] bg-[var(--bg-subtle)] pl-4 py-3 text-sm text-[var(--fg-muted)]">
      Machine-translated into {languageName}. Automatic translation can miss
      nuance, and specialist economic terminology in particular.{' '}
      <Link
        href={`/articles/${slug}`}
        className="text-gold underline underline-offset-2 hover:no-underline font-semibold"
      >
        Read the English original
      </Link>
      , which remains the definitive version.
    </div>
  )
}
