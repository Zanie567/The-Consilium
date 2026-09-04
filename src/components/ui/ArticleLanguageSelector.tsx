'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Languages } from 'lucide-react'
import { SOURCE_LANGUAGE, TARGET_LOCALES } from '@/lib/translation/locales'

/**
 * Language selector for the top of an article.
 *
 * Built on <details>/<summary> so it is a working disclosure widget with no
 * JavaScript at all: the options are ordinary links to ?lang=xx, which the
 * server renders. The client behaviour layered on top is only an enhancement —
 * a router transition so switching language does not blank the page, an
 * `isPending` state for a restrained inline notice, and dismissal on Escape or
 * an outside click.
 *
 * No translation happens here. This component knows the list of languages and
 * nothing else; the key, the provider and the translated text all stay on the
 * server.
 */

interface Props {
  slug: string
  /** Locale currently rendered: 'en' or a supported target code. */
  current: string
}

interface Option {
  code: string
  nativeName: string
  englishName: string
}

const OPTIONS: Option[] = [
  { ...SOURCE_LANGUAGE },
  ...TARGET_LOCALES.map((l) => ({
    code: l.code,
    nativeName: l.nativeName,
    englishName: l.englishName,
  })),
]

function hrefFor(slug: string, code: string): string {
  return code === SOURCE_LANGUAGE.code
    ? `/articles/${slug}`
    : `/articles/${slug}?lang=${code}`
}

export function ArticleLanguageSelector({ slug, current }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const selected = OPTIONS.find((o) => o.code === current) ?? OPTIONS[0]

  useEffect(() => {
    if (!isPending) setPendingCode(null)
  }, [isPending])

  // Dismiss on Escape or a click outside. Escape returns focus to the summary,
  // which is where the reader's focus already was; nothing else moves focus.
  useEffect(() => {
    const el = detailsRef.current
    if (!el) return

    const close = () => {
      el.open = false
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (el.open && event.target instanceof Node && !el.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && el.open) {
        close()
        el.querySelector('summary')?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const select = (event: React.MouseEvent<HTMLAnchorElement>, option: Option) => {
    // Let modified clicks (new tab, new window, download) behave natively.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    if (detailsRef.current) detailsRef.current.open = false
    if (option.code === current) return
    setPendingCode(option.code)
    startTransition(() => {
      router.push(hrefFor(slug, option.code))
    })
  }

  const pendingOption = pendingCode ? OPTIONS.find((o) => o.code === pendingCode) : null

  return (
    <div className="no-print flex items-center justify-end gap-3">
      {isPending && pendingOption && (
        <span
          className="text-[var(--fg-faint)] text-xs tracking-wide"
          role="status"
          aria-live="polite"
        >
          Translating into {pendingOption.englishName}…
        </span>
      )}

      <details ref={detailsRef} className="relative">
        <summary
          className="list-none cursor-pointer select-none flex items-center gap-1.5 min-h-11 sm:min-h-0 sm:py-1 text-[var(--fg-muted)] hover:text-gold transition-colors duration-200 text-xs font-semibold uppercase tracking-widest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden"
          aria-label={`Article language: ${selected.englishName}. Choose another language`}
        >
          <Languages size={15} aria-hidden="true" />
          <span aria-hidden="true">{selected.nativeName}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </summary>

        <ul className="absolute right-0 z-30 mt-1 min-w-[10.5rem] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)] py-1">
          {OPTIONS.map((option) => {
            const isCurrent = option.code === current
            return (
              <li key={option.code}>
                <a
                  href={hrefFor(slug, option.code)}
                  hrefLang={option.code}
                  lang={option.code}
                  onClick={(event) => select(event, option)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`flex items-center justify-between gap-3 px-3 min-h-11 sm:min-h-0 sm:py-2 text-sm transition-colors duration-150 ${
                    isCurrent
                      ? 'text-gold font-semibold'
                      : 'text-[var(--fg-muted)] hover:text-gold hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  <span>{option.nativeName}</span>
                  {isCurrent && (
                    <span aria-hidden="true" className="text-gold text-xs">
                      ✓
                    </span>
                  )}
                  <span className="sr-only">
                    {option.englishName}
                    {isCurrent ? ' (currently selected)' : ''}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}
