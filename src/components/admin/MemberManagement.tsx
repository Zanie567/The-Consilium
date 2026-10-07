'use client'

import { useState } from 'react'
import { apiRequest, asApiError } from '@/lib/apiClient'
import type { AccountStatus, MemberRow, ProfileStatus } from '@/lib/membership'
import { TEAM_TIER_ORDER, type TeamTierId } from '@/lib/teamHierarchy'

const ROLES = ['WRITER', 'EDITOR', 'GROWTH', 'ADMIN'] as const
const TIER_LABEL: Record<TeamTierId, string> = {
  editor_in_chief: 'Editor-in-Chief',
  deputy: 'Deputy Editor-in-Chief',
  leadership: 'Leadership',
  senior_editor: 'Senior editor',
  editor: 'Editor',
  junior_editor: 'Junior editor',
  writer: 'Writer',
  growth: 'Growth & Communications',
  other: 'Wider team',
}
const TIERS = [{ value: '', label: 'Follow the public title' }, ...TEAM_TIER_ORDER.map((value) => ({ value, label: TIER_LABEL[value] }))]

const ACCOUNT_LABEL: Record<AccountStatus, string> = {
  invited: 'Invited, not registered',
  unverified: 'Registered, email not confirmed',
  active: 'Active',
  suspended: 'Suspended',
  revoked: 'Revoked',
}
const PROFILE_LABEL: Record<ProfileStatus, string> = {
  'not-started': 'No profile yet',
  incomplete: 'Profile incomplete',
  hidden: 'Complete, hidden',
  published: 'Published',
}

const field =
  'w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] focus:border-gold focus:outline-none'
const label = 'block text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-1'
const button =
  'inline-flex min-h-[40px] items-center px-4 text-xs font-bold uppercase tracking-widest disabled:opacity-60'

function Chip({ children, tone }: { children: React.ReactNode; tone: 'good' | 'warn' | 'bad' | 'plain' }) {
  const colour = {
    good: 'border-emerald-600/40 text-emerald-600',
    warn: 'border-amber-500/50 text-amber-600',
    bad: 'border-red-500/40 text-red-500',
    plain: 'border-[var(--border)] text-[var(--fg-muted)]',
  }[tone]
  return <span className={`inline-block border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${colour}`}>{children}</span>
}

const accountTone = (s: AccountStatus) => (s === 'active' ? 'good' : s === 'revoked' || s === 'suspended' ? 'bad' : 'warn')
const profileTone = (s: ProfileStatus) => (s === 'published' ? 'good' : s === 'hidden' ? 'plain' : 'warn')

export function MemberManagement({ initialMembers }: { initialMembers: MemberRow[]; currentAdminEmail?: string | null }) {
  const [members, setMembers] = useState(initialMembers)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [hideOnRevoke, setHideOnRevoke] = useState(false)
  const [invite, setInvite] = useState({ email: '', role: 'WRITER', displayName: '', position: '', tier: '' })
  const [edit, setEdit] = useState({ position: '', tier: '', order: '', visible: false })
  const [reinstateRole, setReinstateRole] = useState('WRITER')

  const reload = async () => setMembers(await apiRequest<MemberRow[]>('/api/admin/members'))

  const run = async (action: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const text = await action()
      await reload()
      setMessage({ ok: true, text })
    } catch (reason) {
      setMessage({ ok: false, text: asApiError(reason).message })
    } finally {
      setBusy(false)
    }
  }

  const sendInvite = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const result = await apiRequest<{ outcome: string }>('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: invite.email,
          role: invite.role,
          ...(invite.displayName ? { displayName: invite.displayName } : {}),
          ...(invite.position ? { position: invite.position } : {}),
          ...(invite.tier ? { publicTier: invite.tier } : {}),
        }),
      })
      setInvite({ email: '', role: 'WRITER', displayName: '', position: '', tier: '' })
      return result.outcome === 'activated'
        ? 'They already had an account, so the role is active now.'
        : 'Invitation saved. The role switches on when they sign in with that email.'
    })
  }

  const patch = (id: string, body: Record<string, unknown>, text: string) =>
    run(async () => {
      await apiRequest(`/api/admin/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return text
    })

  const openRow = (member: MemberRow) => {
    setOpenId(openId === member.id ? null : member.id)
    setConfirmRevokeId(null)
    setEdit({
      position: member.position ?? '',
      tier: member.tier ?? '',
      order: member.order === null ? '' : String(member.order),
      visible: member.visible ?? false,
    })
  }

  const saveProfile = (member: MemberRow) =>
    patch(
      member.id,
      {
        position: edit.position,
        publicTier: edit.tier || null,
        ...(member.hasAccount && edit.order !== '' ? { order: Number(edit.order) } : {}),
        ...(member.hasAccount ? { visible: edit.visible } : {}),
      },
      'Public details saved.',
    )

  return (
    <div className="space-y-8">
      <form onSubmit={sendInvite} className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5" aria-label="Invite a member">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Add a member</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Works whether or not they have an account yet. Use the email they will sign in with.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label htmlFor="inv-email" className={label}>Email</label>
            <input id="inv-email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={field} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="inv-role" className={label}>Access role</label>
            <select id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className={field}>
              {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="inv-position" className={label}>Public position (optional)</label>
            <input id="inv-position" type="text" maxLength={100} value={invite.position} onChange={(e) => setInvite({ ...invite, position: e.target.value })} className={field} placeholder="e.g. Deputy Editor" />
          </div>
          <div>
            <label htmlFor="inv-tier" className={label}>Placement (optional)</label>
            <select id="inv-tier" value={invite.tier} onChange={(e) => setInvite({ ...invite, tier: e.target.value })} className={field}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button type="submit" disabled={busy} className={`${button} bg-navy text-cream hover:bg-navy/90`}>Add member</button>
          <p role="status" aria-live="polite" className={`text-sm ${message ? (message.ok ? 'text-emerald-600' : 'text-red-500') : ''}`}>{message?.text}</p>
        </div>
      </form>

      <div className="overflow-x-auto border border-[var(--border)]">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-[var(--bg-subtle)] text-xs uppercase tracking-widest text-[var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">Member</th>
              <th className="px-3 py-2">Access role</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Public position</th>
              <th className="px-3 py-2">Profile</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--fg-muted)]">No members yet. Add the first one above.</td></tr>
            )}
            {members.map((m) => (
              <MemberRowView
                key={m.id}
                m={m}
                open={openId === m.id}
                busy={busy}
                edit={edit}
                setEdit={setEdit}
                confirmRevoke={confirmRevokeId === m.id}
                hideOnRevoke={hideOnRevoke}
                setHideOnRevoke={setHideOnRevoke}
                reinstateRole={reinstateRole}
                setReinstateRole={setReinstateRole}
                onToggle={() => openRow(m)}
                onRole={(role) => patch(m.id, { role }, `Role changed to ${role.toLowerCase()}. Their profile is unchanged.`)}
                onSaveProfile={() => saveProfile(m)}
                onAskRevoke={() => { setConfirmRevokeId(m.id); setHideOnRevoke(false) }}
                onCancelRevoke={() => setConfirmRevokeId(null)}
                onRevoke={() =>
                  run(async () => {
                    await apiRequest(`/api/admin/members/${m.id}/revoke`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ hideProfile: hideOnRevoke }),
                    })
                    setConfirmRevokeId(null)
                    return hideOnRevoke ? 'Access revoked and the profile hidden.' : 'Access revoked. The public profile is unchanged.'
                  })
                }
                onReinstate={() =>
                  run(async () => {
                    await apiRequest(`/api/admin/members/${m.id}/reinstate`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role: reinstateRole }),
                    })
                    return 'Member reinstated.'
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface RowProps {
  m: MemberRow
  open: boolean
  busy: boolean
  edit: { position: string; tier: string; order: string; visible: boolean }
  setEdit: (value: RowProps['edit']) => void
  confirmRevoke: boolean
  hideOnRevoke: boolean
  setHideOnRevoke: (value: boolean) => void
  reinstateRole: string
  setReinstateRole: (value: string) => void
  onToggle: () => void
  onRole: (role: string) => void
  onSaveProfile: () => void
  onAskRevoke: () => void
  onCancelRevoke: () => void
  onRevoke: () => void
  onReinstate: () => void
}

function MemberRowView(p: RowProps) {
  const { m } = p
  const revoked = m.accountStatus === 'revoked'
  const todo = [...m.missingFromMember, ...m.missingFromAdmin]
  return (
    <>
      <tr className="border-t border-[var(--border)] align-top" data-testid={`member-${m.email}`}>
        <td className="px-3 py-3">
          <p className="font-bold text-[var(--fg)]">{m.name ?? 'No name yet'}</p>
          <p className="text-xs text-[var(--fg-muted)]">{m.email}</p>
        </td>
        <td className="px-3 py-3">
          {revoked ? (
            <span className="text-[var(--fg-muted)]">None</span>
          ) : (
            <select
              aria-label={`Access role for ${m.email}`}
              value={m.role}
              disabled={p.busy}
              onChange={(e) => p.onRole(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
            >
              {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
            </select>
          )}
        </td>
        <td className="px-3 py-3"><Chip tone={accountTone(m.accountStatus)}>{ACCOUNT_LABEL[m.accountStatus]}</Chip></td>
        <td className="px-3 py-3">
          <p>{m.position ?? <span className="text-[var(--fg-muted)]">Not set</span>}</p>
          <p className="text-xs text-[var(--fg-muted)]">{TIERS.find((t) => t.value === (m.tier ?? ''))?.label}</p>
        </td>
        <td className="px-3 py-3">
          <Chip tone={profileTone(m.profileStatus)}>{PROFILE_LABEL[m.profileStatus]}</Chip>
          {m.profileStatus === 'incomplete' && todo.length > 0 && (
            <p className="mt-1 text-xs text-[var(--fg-muted)]">Needs: {todo.join(', ')}</p>
          )}
        </td>
        <td className="px-3 py-3 text-right">
          <button type="button" onClick={p.onToggle} aria-expanded={p.open} className={`${button} border border-[var(--border-strong)] text-[var(--fg)]`}>
            {p.open ? 'Close' : 'Manage'}
          </button>
        </td>
      </tr>
      {p.open && (
        <tr className="bg-[var(--bg-subtle)]">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor={`pos-${m.id}`} className={label}>Public position</label>
                <input id={`pos-${m.id}`} type="text" maxLength={100} value={p.edit.position} onChange={(e) => p.setEdit({ ...p.edit, position: e.target.value })} className={field} />
              </div>
              <div>
                <label htmlFor={`tier-${m.id}`} className={label}>Public placement</label>
                <select id={`tier-${m.id}`} value={p.edit.tier} onChange={(e) => p.setEdit({ ...p.edit, tier: e.target.value })} className={field}>
                  {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {m.hasAccount && (
                <>
                  <div>
                    <label htmlFor={`order-${m.id}`} className={label}>Display order</label>
                    <input id={`order-${m.id}`} type="number" min={0} max={9999} value={p.edit.order} onChange={(e) => p.setEdit({ ...p.edit, order: e.target.value })} className={field} />
                  </div>
                  <div className="flex items-end">
                    <label className="flex min-h-[40px] items-center gap-2 text-sm text-[var(--fg)]">
                      <input type="checkbox" checked={p.edit.visible} onChange={(e) => p.setEdit({ ...p.edit, visible: e.target.checked })} />
                      Show on Our Team page
                    </label>
                  </div>
                </>
              )}
            </div>
            {!m.hasAccount && (
              <p className="mt-2 text-xs text-[var(--fg-muted)]">Order and visibility can be set once they have signed in.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" disabled={p.busy} onClick={p.onSaveProfile} className={`${button} bg-navy text-cream hover:bg-navy/90`}>
                Save public details
              </button>
              {revoked ? (
                <>
                  <select aria-label="Role to reinstate" value={p.reinstateRole} onChange={(e) => p.setReinstateRole(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm">
                    {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
                  </select>
                  <button type="button" disabled={p.busy} onClick={p.onReinstate} className={`${button} border border-[var(--border-strong)] text-[var(--fg)]`}>Reinstate access</button>
                </>
              ) : p.confirmRevoke ? (
                <div className="flex flex-wrap items-center gap-3 border border-red-500/40 p-3">
                  <span className="text-sm text-[var(--fg)]">Revoke access for {m.email}? Their profile is kept.</span>
                  {m.hasAccount && (
                    <label className="flex items-center gap-2 text-sm text-[var(--fg)]">
                      <input type="checkbox" checked={p.hideOnRevoke} onChange={(e) => p.setHideOnRevoke(e.target.checked)} />
                      Also hide the public profile
                    </label>
                  )}
                  <button type="button" disabled={p.busy} onClick={p.onRevoke} className={`${button} bg-red-600 text-white`}>Confirm revoke</button>
                  <button type="button" onClick={p.onCancelRevoke} className={`${button} text-[var(--fg-muted)]`}>Cancel</button>
                </div>
              ) : (
                <button type="button" disabled={p.busy} onClick={p.onAskRevoke} className={`${button} border border-red-500/50 text-red-500`}>Revoke access</button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
