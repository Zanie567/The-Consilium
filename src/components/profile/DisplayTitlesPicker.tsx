'use client'

import { Check } from 'lucide-react'
import { ALLOWED_DISPLAY_TITLES, MAX_DISPLAY_TITLES } from '@/lib/displayTitles'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  legend?: string
}

/**
 * Pick up to four titles from the closed list. Nothing is free text. A server check
 * and a database constraint repeat these rules, so this only shapes the choice.
 */
export function DisplayTitlesPicker({ value, onChange, disabled, legend = 'Display titles' }: Props) {
  const atLimit = value.length >= MAX_DISPLAY_TITLES

  const toggle = (title: string) => {
    if (value.includes(title)) onChange(value.filter((t) => t !== title))
    else if (!atLimit) onChange([...value, title])
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-[var(--fg-faint)]">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {ALLOWED_DISPLAY_TITLES.map((title) => {
          const selected = value.includes(title)
          const blocked = !selected && atLimit
          return (
            <label
              key={title}
              className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2 text-xs font-semibold transition-colors ${
                selected
                  ? 'border-gold bg-gold/10 text-gold'
                  : 'border-[var(--border)] text-[var(--fg)] hover:border-gold/50'
              } ${blocked || disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected}
                disabled={blocked || disabled}
                onChange={() => toggle(title)}
              />
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                  selected ? 'border-gold bg-gold text-navy' : 'border-[var(--border-strong)]'
                }`}
              >
                {selected && <Check size={11} />}
              </span>
              {title}
            </label>
          )
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--fg-faint)]">
        Up to {MAX_DISPLAY_TITLES}. Titles are labels only and do not change what you can do on the site.
      </p>
    </fieldset>
  )
}
