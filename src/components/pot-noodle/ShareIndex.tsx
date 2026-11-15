'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, Link2, Share2 } from 'lucide-react'

const noSubscribe = () => () => {}

/**
 * "Share the Index": the phone's share sheet where there is one, otherwise copy the link. Each
 * outcome is reported only once it has actually happened (a cancelled share says nothing).
 */
export function ShareIndex({ url, title, text }: { url: string; title: string; text: string }) {
  const [status, setStatus] = useState('')
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === 'function', () => false)
  const canCopy = useSyncExternalStore(noSubscribe, () => typeof navigator.clipboard?.writeText === 'function', () => false)

  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(''), 3000)
    return () => clearTimeout(t)
  }, [status])

  const share = async () => {
    try {
      await navigator.share({ title, text, url })
    } catch {
      // Cancelled or refused: nothing to report.
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setStatus('Link copied')
    } catch {
      setStatus('Could not copy: the address is shown below')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canShare && (
        <button type="button" onClick={share} className="btn-press inline-flex min-h-11 items-center gap-2 border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 text-sm font-semibold text-[var(--fg)] hover:border-gold">
          <Share2 size={15} aria-hidden /> Share the Index
        </button>
      )}
      {canCopy && (
        <button type="button" onClick={copy} className="btn-press inline-flex min-h-11 items-center gap-2 border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-5 text-sm font-semibold text-[var(--fg)] hover:border-gold">
          {status === 'Link copied' ? <Check size={15} aria-hidden className="text-gold-dark dark:text-gold" /> : <Link2 size={15} aria-hidden />}
          Copy link
        </button>
      )}
      <span role="status" aria-live="polite" className="text-sm text-[var(--fg-muted)]">{status}</span>
      {/* Always readable, with or without JavaScript. */}
      <p className="w-full text-sm text-[var(--fg-muted)]">
        Or send this address: <span className="break-all font-medium text-[var(--fg)]">{url.replace(/^https:\/\//, '')}</span>
      </p>
    </div>
  )
}
