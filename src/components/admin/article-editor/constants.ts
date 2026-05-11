export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  PUBLISHED: 'Published',
  SCHEDULED: 'Scheduled',
  ARCHIVED: 'Archived',
  REJECTED: 'Returned',
}

export const STATUS_COLOURS: Record<string, string> = {
  DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-muted)] border-[var(--border)]',
  PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  SCHEDULED: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)] border-[var(--border)]',
  REJECTED: 'bg-red-500/10 text-red-600 border-red-500/20',
}
