import { resolveTeamTier } from './teamHierarchy'
export interface AppointmentSnapshot {
  id: string; name: string; role: string; order: number; userId: string | null
  publicTier: string | null; permissionRole: string | null
}
/** Snapshot legacy placement once. Runtime placement never consults names or permissions. */
export function publicAppointmentBackfill(rows: AppointmentSnapshot[]) {
  const changes: { id: string; publicTier: string; reason: string }[] = []
  const ambiguous: string[] = []
  for (const row of rows) {
    if (row.publicTier) continue
    if (row.id === 'cmnmbpffj0000n3it54bk52vr') {
      if (row.name !== 'Lucas Dwyer' || row.role.trim() || row.userId) ambiguous.push(`Historical card ${row.id} differs from the verified untitled, unowned appointment.`)
      else changes.push({ id: row.id, publicTier: 'leadership', reason: 'Preserve verified legacy leadership card by ID' })
    } else if (resolveTeamTier(row.role) === 'other' && row.permissionRole) {
      const tier = ({ WRITER: 'writer', EDITOR: 'editor', GROWTH: 'growth' } as Record<string, string>)[row.permissionRole]
      if (tier) changes.push({ id: row.id, publicTier: tier, reason: 'Snapshot previously implicit ordinary placement' })
      else ambiguous.push(`Card ${row.id}: unclassified linked ${row.permissionRole}; public appointment needs explicit review.`)
    }
  }
  return { version: 1, rows, changes, ambiguous }
}
