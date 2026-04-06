'use client'

import { FileDown } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

interface SaveAsPdfButtonProps {
  title: string
}

export function SaveAsPdfButton({ title }: SaveAsPdfButtonProps) {
  const handleSave = () => {
    const prev = document.title
    document.title = title
    window.print()
    // Restore after a tick (print dialog is sync-blocking in most browsers)
    setTimeout(() => { document.title = prev }, 500)
  }

  return (
    <Tooltip content="Save this article as a PDF file">
      <button
        onClick={handleSave}
        aria-label="Save article as PDF"
        className="no-print flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-gold transition-colors duration-200 text-xs font-semibold uppercase tracking-widest"
      >
        <FileDown size={15} />
        <span>Save PDF</span>
      </button>
    </Tooltip>
  )
}
