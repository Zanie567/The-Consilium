/** Display-only wording. Retain the legacy REJECTED database status for edit/resubmit permissions. */
export function articleStatusLabel(status: string): string {
  return status === 'REJECTED' ? 'Revisions requested' : status.replaceAll('_', ' ')
}
