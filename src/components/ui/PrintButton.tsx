'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      aria-label="Print article"
      className="no-print flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-gold transition-colors duration-200 text-xs font-semibold uppercase tracking-widest"
    >
      <Printer size={15} />
      <span>Print</span>
    </button>
  )
}
