import { it, expect } from 'vitest'
import { publicAppointmentBackfill, type AppointmentSnapshot } from '../../src/lib/publicAppointmentBackfill'
const row = (patch: Partial<AppointmentSnapshot> = {}): AppointmentSnapshot => ({ id: 'card', name: 'A member', role: 'Writer', order: 2, userId: 'owner', publicTier: null, permissionRole: 'WRITER', ...patch })
it('never changes trusted appointments including an ADMIN chief or other titled members', () => {
  const rows = [row({ role: 'Editor-in-Chief', permissionRole: 'ADMIN', order: 1 }), row({ id: 'second', role: 'Senior Editor' })]
  expect(publicAppointmentBackfill(rows)).toMatchObject({ changes: [], ambiguous: [] })
})
it('preserves the verified historical card by ID, never granting placement from a supplied name', () => {
  expect(publicAppointmentBackfill([row({ name: 'Lucas Dwyer', role: '', userId: null, permissionRole: null })]).changes).toEqual([])
  const historical = row({ id: 'cmnmbpffj0000n3it54bk52vr', name: 'Lucas Dwyer', role: '', userId: null, permissionRole: null })
  const plan = publicAppointmentBackfill([historical])
  expect(plan.changes).toHaveLength(1)
  expect(publicAppointmentBackfill([{ ...historical, publicTier: 'leadership' }]).changes).toEqual([])
  expect(publicAppointmentBackfill([{ ...historical, name: 'Different person' }]).ambiguous).toHaveLength(1)
  expect(publicAppointmentBackfill([historical])).toEqual(plan)
})
it('snapshots existing implicit placement but reports unclassified ADMIN ownership', () => {
  expect(publicAppointmentBackfill([row({ role: 'Social Media', permissionRole: 'GROWTH' })]).changes[0].publicTier).toBe('growth')
  expect(publicAppointmentBackfill([row({ role: '', permissionRole: 'ADMIN' })]).ambiguous).toHaveLength(1)
})
