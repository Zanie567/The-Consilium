'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import type { MemberRow } from '@/lib/membership'
import type { RecentSignup, UnlinkedCardRow } from '@/lib/teamDirectory'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { apiRequest } from '@/lib/apiClient'
import { TeamProfileEditor, TIERS, buttonClass, fieldClass, labelClass } from '@/components/admin/TeamProfileEditor'

export const ROLES = ['WRITER', 'EDITOR', 'GROWTH', 'ADMIN'] as const
export const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase()

export type DetailTab = 'account' | 'role' | 'profile'
const TABS: { id: DetailTab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'role', label: 'Role & permissions' },
  { id: 'profile', label: 'Public profile' },
]

interface Props {
  member: MemberRow
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  unlinkedCards: UnlinkedCardRow[]
  suggestions: RecentSignup['suggestions']
  isSelf: boolean
  /** Runs a mutation, then reloads the directory and shows the message. Serialises clicks. */
  run: (action: () => Promise<string>) => Promise<boolean>
  busy: boolean
  reload: () => Promise<void>
  onMessage: (message: { ok: boolean; text: string }) => void
  onDirtyChange: (dirty: boolean) => void
}

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function TeamMemberDetail(p: Props) {
  const { member: m } = p
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = TABS.findIndex((t) => t.id === p.tab)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    p.onTab(next.id)
    document.getElementById(`tab-${m.id}-${next.id}`)?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label={`Manage ${m.name ?? m.email}`} onKeyDown={onKeyDown} className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${m.id}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={p.tab === t.id}
            aria-controls={`panel-${m.id}-${t.id}`}
            tabIndex={p.tab === t.id ? 0 : -1}
            onClick={() => p.onTab(t.id)}
            className={`-mb-px min-h-[40px] border-b-2 px-4 text-xs font-bold uppercase tracking-widest ${p.tab === t.id ? 'border-gold text-[var(--fg)]' : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${m.id}-${p.tab}`} aria-labelledby={`tab-${m.id}-${p.tab}`}>
        {p.tab === 'account' && <AccountSection {...p} />}
        {p.tab === 'role' && <RoleSection {...p} />}
        {p.tab === 'profile' && <ProfileSection {...p} />}
      </div>
    </div>
  )
}

// ── Account ─────────────────────────────────────────────────────────────────

function AccountSection({ member: m, run, busy }: Props) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [hideOnRevoke, setHideOnRevoke] = useState(false)
  const [reinstateRole, setReinstateRole] = useState<string>('WRITER')
  const revoked = m.accountStatus === 'revoked'

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact term="Name">{m.name ?? 'No name yet'}</Fact>
        <Fact term="Email">{m.email}</Fact>
        <Fact term="Email confirmed">{m.hasAccount ? (m.emailVerified ? 'Yes' : 'Not yet') : 'No account yet'}</Fact>
        <Fact term="Account created">{m.accountCreatedAt ? format(new Date(m.accountCreatedAt), 'd MMM yyyy') : 'Has not registered'}</Fact>
        <Fact term="Added as a member">{format(new Date(m.createdAt), 'd MMM yyyy')}{m.invitedByName ? ` by ${m.invitedByName}` : ''}</Fact>
        <Fact term="Public profile">{m.card ? `${m.card.name}, linked to this account` : 'None linked'}</Fact>
      </dl>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        {revoked ? (
          <>
            <select aria-label="Role to reinstate" value={reinstateRole} onChange={(e) => setReinstateRole(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                await apiRequest(`/api/admin/members/${m.id}/reinstate`, json('POST', { role: reinstateRole }))
                return 'Member reinstated.'
              })}
              className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}
            >
              Reinstate access
            </button>
          </>
        ) : confirmRevoke ? (
          <div className="flex flex-wrap items-center gap-3 border border-red-500/40 p-3">
            <span className="text-sm text-[var(--fg)]">Revoke access for {m.email}? Their profile is kept.</span>
            {m.hasAccount && (
              <label className="flex items-center gap-2 text-sm text-[var(--fg)]">
                <input type="checkbox" checked={hideOnRevoke} onChange={(e) => setHideOnRevoke(e.target.checked)} />
                Also hide the public profile
              </label>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                await apiRequest(`/api/admin/members/${m.id}/revoke`, json('POST', { hideProfile: hideOnRevoke }))
                setConfirmRevoke(false)
                return hideOnRevoke ? 'Access revoked and the profile hidden.' : 'Access revoked. The public profile is unchanged.'
              })}
              className={`${buttonClass} bg-red-600 text-white`}
            >
              Confirm revoke
            </button>
            <button type="button" onClick={() => setConfirmRevoke(false)} className={`${buttonClass} text-[var(--fg-muted)]`}>Cancel</button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => { setConfirmRevoke(true); setHideOnRevoke(false) }} className={`${buttonClass} border border-red-500/50 text-red-500`}>
            Revoke access
          </button>
        )}
      </div>
    </div>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">{term}</dt>
      <dd className="mt-0.5 break-words text-[var(--fg)]">{children}</dd>
    </div>
  )
}

// ── Role & permissions ──────────────────────────────────────────────────────

function RoleSection({ member: m, run, busy, isSelf }: Props) {
  const revoked = m.accountStatus === 'revoked'
  const [role, setRole] = useState<string>(m.role)
  const changed = role !== m.role

  if (revoked) return <p className="text-sm text-[var(--fg-muted)]">Access is revoked, so there is no role to change. Reinstate the member from the Account section.</p>

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-[var(--fg-muted)]">
        The access role decides which pages and actions this person can use. It is <strong>separate from the public position</strong> on
        the Meet the Team page: changing it never edits their profile, and changing their position never changes what they can do.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`role-${m.id}`} className={labelClass}>Access role</label>
          <select
            id={`role-${m.id}`}
            aria-label={`Access role for ${m.email}`}
            value={role}
            disabled={busy || isSelf}
            onChange={(e) => setRole(e.target.value)}
            className={`${fieldClass} min-w-[180px]`}
          >
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <button
          type="button"
          disabled={busy || isSelf || !changed}
          onClick={() => void run(async () => {
            await apiRequest(`/api/admin/members/${m.id}`, json('PATCH', { role }))
            return `Role changed to ${role.toLowerCase()}. Their profile is unchanged.`
          })}
          className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}
        >
          Change role
        </button>
      </div>
      {isSelf && <p className="text-xs text-[var(--fg-muted)]">You cannot change your own role. Ask another administrator.</p>}
      {m.role === 'ADMIN' && !isSelf && (
        <p className="text-xs text-[var(--fg-muted)]">Administrators can manage every part of the portal. Their public position is unaffected.</p>
      )}
    </div>
  )
}

// ── Public profile ──────────────────────────────────────────────────────────

function ProfileSection(p: Props) {
  const { member: m, unlinkedCards, suggestions, run, busy, reload, onMessage, onDirtyChange } = p
  const [creating, setCreating] = useState(false)
  const [pick, setPick] = useState('')
  const [confirm, setConfirm] = useState<'unlink' | 'delete' | null>(null)
  const [invited, setInvited] = useState({ position: m.position ?? '', tier: m.tier ?? '' })

  const saved = async (message: string) => {
    await reload()
    onMessage({ ok: true, text: message })
    setCreating(false)
  }

  // Invitation with no account yet: only the starting values can be prepared.
  if (!m.userId) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-sm text-[var(--fg-muted)]">
          {m.hasAccount
            ? 'They have registered but not confirmed their email, so a profile cannot be linked yet. It becomes available as soon as they confirm.'
            : 'They have no account yet. You can prepare the position now; their profile is created when they sign in.'}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`pos-${m.id}`} className={labelClass}>Public position</label>
            <input id={`pos-${m.id}`} maxLength={100} value={invited.position} onChange={(e) => setInvited({ ...invited, position: e.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={`tier-${m.id}`} className={labelClass}>Public placement</label>
            <select id={`tier-${m.id}`} value={invited.tier} onChange={(e) => setInvited({ ...invited, tier: e.target.value })} className={fieldClass}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            await apiRequest(`/api/admin/members/${m.id}`, json('PATCH', { position: invited.position, publicTier: invited.tier || null }))
            return 'Public details saved.'
          })}
          className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}
        >
          Save public details
        </button>
      </div>
    )
  }

  if (m.card) {
    const card = m.card
    return (
      <div className="space-y-6">
        <p className="text-sm text-[var(--fg-muted)]">
          This profile belongs to <strong>{m.email}</strong>. They can edit their own name, photo and biography; only administrators can
          change the position, placement, order and visibility below.
        </p>
        <TeamProfileEditor card={card} onSaved={saved} onDirtyChange={onDirtyChange} />
        <div className="flex flex-wrap gap-3 border-t border-[var(--border)] pt-4">
          <button type="button" disabled={busy} onClick={() => setConfirm('unlink')} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
            Unlink from account
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirm('delete')} className={`${buttonClass} border border-red-500/50 text-red-500`}>
            Delete profile
          </button>
        </div>
        <ConfirmDialog
          open={confirm === 'unlink'}
          title="Unlink this profile?"
          message={`"${card.name}" stays on the Meet the Team page exactly as it is, but ${m.email} can no longer edit it. You can link it to this or another account again.`}
          confirmLabel="Unlink"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(async () => {
            await apiRequest(`/api/admin/team-cards/${card.id}/link`, json('DELETE', { expectedUpdatedAt: card.updatedAt }))
            setConfirm(null)
            return 'Profile unlinked. Nothing on it was changed.'
          }).then(() => setConfirm(null))}
        />
        <ConfirmDialog
          open={confirm === 'delete'}
          title="Delete this profile?"
          message={`"${card.name}" is removed from the Meet the Team page and its text and photo link are deleted. The account and its access role are not affected. ${m.email} can create a new, hidden profile afterwards.`}
          confirmLabel="Delete profile"
          tone="danger"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(async () => {
            await apiRequest(`/api/team/${card.id}`, json('DELETE', { expectedUpdatedAt: card.updatedAt }))
            return 'Profile deleted.'
          }).then(() => setConfirm(null))}
        />
      </div>
    )
  }

  // An account with no profile: assign an existing one or create a new one.
  const suggested = new Set(suggestions.map((s) => s.cardId))
  const options = [...unlinkedCards].sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.name.localeCompare(b.name))
  const chosen = unlinkedCards.find((c) => c.id === pick)

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--fg)]">
        <strong>{m.name ?? m.email}</strong> has no public profile yet. Link their existing Meet the Team profile, or create a new one.
      </p>

      {options.length > 0 ? (
        <div className="max-w-xl space-y-2">
          <label htmlFor={`assign-${m.id}`} className={labelClass}>Existing profile without an account</label>
          <div className="flex flex-wrap gap-3">
            <select id={`assign-${m.id}`} value={pick} onChange={(e) => setPick(e.target.value)} className={`${fieldClass} min-w-[240px] flex-1`}>
              <option value="">Choose a profile…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.position ? `, ${c.position}` : ''}{suggested.has(c.id) ? ' (likely)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !chosen}
              onClick={() => chosen && void run(async () => {
                await apiRequest(`/api/admin/team-cards/${chosen.id}/link`, json('POST', { userId: m.userId, expectedUpdatedAt: chosen.updatedAt }))
                setPick('')
                return `Linked "${chosen.name}" to ${m.email}. Nothing on the profile was changed.`
              })}
              className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}
            >
              Link profile
            </button>
          </div>
          <p className="text-xs text-[var(--fg-muted)]">
            {suggestions.length > 0
              ? '"Likely" means the profile shares this account’s email or name. Check it is the same person before linking.'
              : 'Only profiles with no owner are listed, so nobody else’s profile can be taken.'}
          </p>
          {chosen && (
            <p className="border-l-2 border-gold pl-3 text-xs text-[var(--fg-muted)]">
              {chosen.name} · {chosen.position || 'No position'} · {chosen.visible ? 'currently public' : 'currently hidden'}
              {chosen.email ? ` · card email ${chosen.email}` : ''}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--fg-muted)]">There are no unowned profiles to link.</p>
      )}

      <div className="border-t border-[var(--border)] pt-4">
        {creating ? (
          <TeamProfileEditor card={null} linkToUserId={m.userId} defaultName={m.name ?? ''} onSaved={saved} onDirtyChange={onDirtyChange} />
        ) : (
          <button type="button" disabled={busy} onClick={() => setCreating(true)} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
            Create a new profile
          </button>
        )}
      </div>
    </div>
  )
}

