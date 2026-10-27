const STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
  SCHEDULED: 'bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/30',
  SENDING: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40',
  SENT: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
  FAILED: 'bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30',
  BLOCKED: 'bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30',
  CANCELLED: 'bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-500/20',
  SKIPPED: 'bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-500/20',
}

const LABELS: Record<string, string> = {
  DRAFT: 'Draft: awaiting approval',
  SCHEDULED: 'Approved and scheduled',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  BLOCKED: 'Blocked by safety check',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
}

export function CampaignStatus({ status, compact = false }: { status: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${STYLES[status] ?? STYLES.DRAFT}`}>
      {compact ? status.charAt(0) + status.slice(1).toLowerCase() : LABELS[status] ?? status}
    </span>
  )
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-navy text-gold dark:bg-gold dark:text-navy">
      {kind === 'WEEKLY' ? 'Weekly' : 'Alert'}
    </span>
  )
}
