'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { apiRequest, asApiError } from '@/lib/apiClient'
import type { AccountStatus, MemberRow, ProfileStatus } from '@/lib/membership'
import type { TeamDirectory, UnlinkedCardRow } from '@/lib/teamDirectory'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  MEMBER_FILTERS,
  filterMembers,
  isNewWithoutProfile,
  needsProfile,
  sortMembers,
  summariseMembers,
  type MemberFilter,
  type MemberSort,
} from '@/lib/teamMembersView'
import { TeamMemberDetail, ROLES, roleLabel, type DetailTab } from '@/components/admin/TeamMemberDetail'
import { TeamProfileEditor, TIERS, buttonClass, fieldClass, labelClass } from '@/components/admin/TeamProfileEditor'

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

type Tone = 'good' | 'warn' | 'bad' | 'plain'
function Chip({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const colour = {
    good: 'border-emerald-600/40 text-emerald-600',
    warn: 'border-amber-500/50 text-amber-600',
    bad: 'border-red-500/40 text-red-500',
    plain: 'border-[var(--border)] text-[var(--fg-muted)]',
  }[tone]
  return <span className={`inline-block border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${colour}`}>{children}</span>
}
const accountTone = (s: AccountStatus): Tone => (s === 'active' ? 'good' : s === 'revoked' || s === 'suspended' ? 'bad' : 'warn')
const profileTone = (s: ProfileStatus): Tone => (s === 'published' ? 'good' : s === 'hidden' ? 'plain' : 'warn')

/**
 * A member's stable identity on screen. The row id is NOT stable: a staff account that pre-dates
 * memberships is listed as `acct-<userId>` and gets a real membership id on the first admin action
 * (for example a role change). The email is unique across both and never changes underneath you.
 */
const keyOf = (m: MemberRow) => m.email.trim().toLowerCase()

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const SORTS: { value: MemberSort; label: string }[] = [
  { value: 'recent', label: 'Newest accounts' },
  { value: 'name', label: 'Name' },
  { value: 'position', label: 'Public position' },
  { value: 'role', label: 'Access role' },
]

export function TeamMembersWorkspace({ initial, currentAdminEmail }: { initial: TeamDirectory; currentAdminEmail?: string | null }) {
  const [dir, setDir] = useState(initial)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<MemberFilter>('all')
  const [sort, setSort] = useState<MemberSort>('recent')
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('account')
  const [dirty, setDirty] = useState(false)
  const [invite, setInvite] = useState({ email: '', role: 'WRITER', displayName: '', position: '', tier: '' })
  const [authorise, setAuthorise] = useState<Record<string, string>>({})
  // Synchronous latch: a state update is async, so a double-click could fire two mutations first.
  const inFlight = useRef(false)

  const reload = useCallback(async () => {
    setDir(await apiRequest<TeamDirectory>('/api/admin/team-members'))
  }, [])

  const run = useCallback(
    async (action: () => Promise<string>): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setBusy(true)
      setMessage(null)
      try {
        const text = await action()
        // The screen always shows the server's truth after a change, including after a refusal.
        await reload()
        setMessage({ ok: true, text })
        return true
      } catch (reason) {
        setMessage({ ok: false, text: asApiError(reason).message })
        await reload().catch(() => {})
        return false
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [reload],
  )

  const summary = useMemo(() => summariseMembers(dir.members), [dir.members])
  // The member being managed stays on screen even if the work just done (for example linking
  // their profile) means they no longer match the active filter. Closing the panel releases it.
  const visible = useMemo(() => {
    const matching = filterMembers(dir.members, { query, filter })
    const open = openId ? dir.members.find((m) => keyOf(m) === openId) : undefined
    return sortMembers(open && !matching.includes(open) ? [...matching, open] : matching, sort)
  }, [dir.members, query, filter, sort, openId])
  const suggestionsFor = (m: MemberRow) => dir.recentSignups.find((s) => s.id === m.userId)?.suggestions ?? []

  function toggle(member: MemberRow) {
    if (openId === keyOf(member)) {
      if (dirty && !window.confirm('You have unsaved changes to this profile. Close without saving?')) return
      setOpenId(null)
      setDirty(false)
      return
    }
    if (dirty && !window.confirm('You have unsaved changes to this profile. Open another member without saving?')) return
    setDirty(false)
    setOpenId(keyOf(member))
    setTab(needsProfile(member) ? 'profile' : 'account')
  }

  const sendInvite = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const result = await apiRequest<{ outcome: string }>('/api/admin/members', json('POST', {
        email: invite.email,
        role: invite.role,
        ...(invite.displayName ? { displayName: invite.displayName } : {}),
        ...(invite.position ? { position: invite.position } : {}),
        ...(invite.tier ? { publicTier: invite.tier } : {}),
      }))
      setInvite({ email: '', role: 'WRITER', displayName: '', position: '', tier: '' })
      return result.outcome === 'activated'
        ? 'They already had an account, so the role is active now.'
        : 'Invitation saved. The role switches on when they sign in with that email.'
    })
  }

  const filterButton = (value: MemberFilter, label: string, count?: number) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`min-h-[40px] border px-3 text-xs font-bold uppercase tracking-widest ${filter === value ? 'border-gold bg-navy text-gold' : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-gold'}`}
    >
      {label}{count ? <span className="ml-1.5 text-gold">{count}</span> : null}
    </button>
  )

  const reviewIssues = dir.issues.filter((i) => i.severity === 'review')
  const infoIssues = dir.issues.filter((i) => i.severity === 'info')

  return (
    <div className="space-y-8">
      <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${message ? (message.ok ? 'text-emerald-600' : 'text-red-500') : ''}`}>
        {message?.text}
      </p>

      {/* Summary */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Members', value: summary.total },
          { label: 'Need a profile', value: summary.needProfile, alert: summary.needProfile > 0 },
          { label: 'On the public page', value: summary.publicProfiles },
          { label: 'Profile not public', value: summary.notPublic },
          { label: 'Invited', value: summary.pendingInvites },
        ].map((s) => (
          <div key={s.label} className={`border p-3 ${s.alert ? 'border-amber-500/60' : 'border-[var(--border)]'}`}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">{s.label}</dt>
            <dd className="mt-1 text-2xl font-bold text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* Recently registered accounts that are not members yet */}
      {dir.recentSignups.length > 0 && (
        <section aria-labelledby="signups-heading" className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
          <h2 id="signups-heading" className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Recent sign-ups</h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Accounts created in the last 30 days that have no team access yet. Authorise one to make them a member, then assign their profile.
          </p>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {dir.recentSignups.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid={`signup-${s.email}`}>
                <div className="min-w-[220px] flex-1">
                  <p className="font-semibold text-[var(--fg)]">{s.name ?? 'No name'}</p>
                  <p className="text-xs text-[var(--fg-muted)]">
                    {s.email} · registered {format(new Date(s.createdAt), 'd MMM yyyy')} · {s.emailVerified ? 'email confirmed' : 'email not confirmed'}
                    {s.suggestions.length > 0 && ` · possible existing profile: ${s.suggestions.map((x) => x.name).join(', ')}`}
                  </p>
                </div>
                <select
                  aria-label={`Role for ${s.email}`}
                  value={authorise[s.id] ?? 'WRITER'}
                  onChange={(e) => setAuthorise({ ...authorise, [s.id]: e.target.value })}
                  className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    const result = await apiRequest<{ outcome: string }>('/api/admin/members', json('POST', { email: s.email, role: authorise[s.id] ?? 'WRITER' }))
                    return result.outcome === 'activated'
                      ? `${s.email} is now a member. Open them below to assign their public profile.`
                      : 'Invitation saved. The role switches on once they confirm their email.'
                  })}
                  className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}
                >
                  Authorise
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Add by email */}
      <form onSubmit={sendInvite} className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5" aria-label="Invite a member">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Add a member</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">Works whether or not they have an account yet. Use the email they will sign in with.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label htmlFor="inv-email" className={labelClass}>Email</label>
            <input id="inv-email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={fieldClass} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="inv-role" className={labelClass}>Access role</label>
            <select id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className={fieldClass}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="inv-position" className={labelClass}>Public position (optional)</label>
            <input id="inv-position" type="text" maxLength={100} value={invite.position} onChange={(e) => setInvite({ ...invite, position: e.target.value })} className={fieldClass} placeholder="e.g. Deputy Editor" />
          </div>
          <div>
            <label htmlFor="inv-tier" className={labelClass}>Placement (optional)</label>
            <select id="inv-tier" value={invite.tier} onChange={(e) => setInvite({ ...invite, tier: e.target.value })} className={fieldClass}>
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button type="submit" disabled={busy} className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}>Add member</button>
        </div>
      </form>

      {/* People */}
      <section aria-labelledby="people-heading">
        <h2 id="people-heading" className="sr-only">People</h2>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label htmlFor="member-search" className={labelClass}>Search</label>
            <input id="member-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, position or role" className={fieldClass} />
          </div>
          <div>
            <label htmlFor="member-sort" className={labelClass}>Sort by</label>
            <select id="member-sort" value={sort} onChange={(e) => setSort(e.target.value as MemberSort)} className={fieldClass}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div role="group" aria-label="Filter members" className="mb-3 flex flex-wrap gap-2">
          {MEMBER_FILTERS.map((f) => filterButton(f.value, f.label, f.value === 'needs-profile' ? summary.needProfile : undefined))}
        </div>

        <div className="overflow-x-auto border border-[var(--border)]">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Team members</caption>
            <thead className="bg-[var(--bg-subtle)] text-xs uppercase tracking-widest text-[var(--fg-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2">Member</th>
                <th scope="col" className="px-3 py-2">Access role</th>
                <th scope="col" className="px-3 py-2">Account</th>
                <th scope="col" className="px-3 py-2">Public position</th>
                <th scope="col" className="px-3 py-2">Public profile</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[var(--fg-muted)]">
                    {dir.members.length === 0 ? 'No members yet. Add the first one above.' : 'No members match this search or filter.'}
                  </td>
                </tr>
              )}
              {visible.map((m) => {
                const open = openId === keyOf(m)
                const isNew = isNewWithoutProfile(m)
                const todo = [...m.missingFromMember, ...m.missingFromAdmin]
                return (
                  <MemberRowGroup key={keyOf(m)} open={open}
                    row={
                      <tr className="border-t border-[var(--border)] align-top" data-testid={`member-${m.email}`}>
                        <td className="px-3 py-3">
                          <p className="font-bold text-[var(--fg)]">
                            {m.name ?? 'No name yet'}
                            {isNew && <span className="ml-2 align-middle"><Chip tone="warn">New</Chip></span>}
                          </p>
                          <p className="text-xs text-[var(--fg-muted)]">{m.email}</p>
                          {m.accountCreatedAt && <p className="text-xs text-[var(--fg-muted)]">Joined {format(new Date(m.accountCreatedAt), 'd MMM yyyy')}</p>}
                        </td>
                        <td className="px-3 py-3">{m.accountStatus === 'revoked' ? <span className="text-[var(--fg-muted)]">None</span> : <Chip tone="plain">{roleLabel(m.role)}</Chip>}</td>
                        <td className="px-3 py-3"><Chip tone={accountTone(m.accountStatus)}>{ACCOUNT_LABEL[m.accountStatus]}</Chip></td>
                        <td className="px-3 py-3">
                          <p>{m.position ?? <span className="text-[var(--fg-muted)]">Not set</span>}</p>
                          <p className="text-xs text-[var(--fg-muted)]">{TIERS.find((t) => t.value === (m.tier ?? ''))?.label}</p>
                        </td>
                        <td className="px-3 py-3">
                          <Chip tone={profileTone(m.profileStatus)}>{PROFILE_LABEL[m.profileStatus]}</Chip>
                          {m.card && <p className="mt-1 text-xs text-[var(--fg-muted)]">Linked to this account</p>}
                          {m.profileStatus === 'incomplete' && todo.length > 0 && <p className="mt-1 text-xs text-[var(--fg-muted)]">Needs: {todo.join(', ')}</p>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button type="button" onClick={() => toggle(m)} aria-expanded={open} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
                            {open ? 'Close' : 'Manage'}
                          </button>
                        </td>
                      </tr>
                    }
                    detail={
                      <tr className="bg-[var(--bg-subtle)]">
                        <td colSpan={6} className="px-4 py-4">
                          <TeamMemberDetail
                            member={m}
                            tab={tab}
                            onTab={setTab}
                            unlinkedCards={dir.unlinkedCards}
                            suggestions={suggestionsFor(m)}
                            isSelf={!!currentAdminEmail && m.email.toLowerCase() === currentAdminEmail.toLowerCase()}
                            run={run}
                            busy={busy}
                            reload={reload}
                            onMessage={setMessage}
                            onDirtyChange={setDirty}
                          />
                        </td>
                      </tr>
                    }
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <UnownedProfiles dir={dir} run={run} busy={busy} reload={reload} onMessage={setMessage} />
      <DisplayOrder dir={dir} run={run} busy={busy} />

      {/* Consistency */}
      <section aria-labelledby="checks-heading" className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
        <h2 id="checks-heading" className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Data checks</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Differences between accounts, memberships and public profiles. Nothing here is changed automatically: review each one and use the actions above.
        </p>
        {dir.issues.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-600">No inconsistencies found.</p>
        ) : (
          <>
            {reviewIssues.length > 0 && (
              <ul className="mt-3 space-y-2" aria-label="Needs review">
                {reviewIssues.map((i, n) => <li key={`r${n}`} className="border-l-2 border-amber-500 pl-3 text-sm text-[var(--fg)]">{i.message}</li>)}
              </ul>
            )}
            {infoIssues.length > 0 && (
              <ul className="mt-3 space-y-1" aria-label="For information">
                {infoIssues.map((i, n) => <li key={`i${n}`} className="border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--fg-muted)]">{i.message}</li>)}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** A table row and its detail row as one unit, so React can key them together. */
function MemberRowGroup({ row, detail, open }: { row: React.ReactNode; detail: React.ReactNode; open: boolean }) {
  return <>{row}{open && detail}</>
}

type RunFn = (action: () => Promise<string>) => Promise<boolean>

// ── Profiles that belong to no account ──────────────────────────────────────

function UnownedProfiles({ dir, run, busy, reload, onMessage }: { dir: TeamDirectory; run: RunFn; busy: boolean; reload: () => Promise<void>; onMessage: (m: { ok: boolean; text: string }) => void }) {
  const [editId, setEditId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<UnlinkedCardRow | null>(null)
  const assignable = dir.members.filter((m) => m.userId && !m.card && m.accountStatus === 'active')

  const saved = async (message: string) => {
    await reload()
    onMessage({ ok: true, text: message })
    setEditId(null)
    setCreating(false)
    setDirty(false)
  }

  return (
    <section aria-labelledby="unowned-heading" className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="unowned-heading" className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Profiles without an account</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-muted)]">
            Meet the Team profiles that no account owns, for example older cards typed in by hand. Assign each to the right person so they can edit it themselves.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => { setCreating(!creating); setEditId(null) }} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
          {creating ? 'Cancel' : 'New profile'}
        </button>
      </div>

      {creating && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <TeamProfileEditor card={null} onSaved={saved} onDirtyChange={setDirty} />
        </div>
      )}

      {dir.unlinkedCards.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--fg-muted)]">Every profile belongs to an account.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {dir.unlinkedCards.map((c) => {
            const editing = editId === c.id
            const target = assign[c.id] ?? ''
            return (
              <li key={c.id} data-testid={`card-${c.id}`} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px] flex-1">
                    <p className="font-semibold text-[var(--fg)]">{c.name}</p>
                    <p className="text-xs text-[var(--fg-muted)]">
                      {c.position || 'No position'} · {c.visible ? 'Public' : 'Hidden'}{c.email ? ` · ${c.email}` : ''}
                    </p>
                  </div>
                  <label className="sr-only" htmlFor={`assign-card-${c.id}`}>Assign {c.name} to an account</label>
                  <select id={`assign-card-${c.id}`} value={target} onChange={(e) => setAssign({ ...assign, [c.id]: e.target.value })} className="min-w-[220px] rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm">
                    <option value="">Assign to account…</option>
                    {assignable.map((m) => <option key={m.userId!} value={m.userId!}>{m.name ?? m.email} ({m.email})</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !target}
                    onClick={() => void run(async () => {
                      const m = assignable.find((x) => x.userId === target)
                      await apiRequest(`/api/admin/team-cards/${c.id}/link`, json('POST', { userId: target, expectedUpdatedAt: c.updatedAt }))
                      setAssign({ ...assign, [c.id]: '' })
                      return `Linked "${c.name}" to ${m?.email ?? 'the account'}. Nothing on the profile was changed.`
                    })}
                    className={`${buttonClass} bg-navy text-cream hover:bg-navy/90`}
                  >
                    Assign
                  </button>
                  <button type="button" disabled={busy} onClick={() => { setEditId(editing ? null : c.id); setCreating(false) }} aria-expanded={editing} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>
                    {editing ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setDeleting(c)} className={`${buttonClass} border border-red-500/50 text-red-500`}>Delete</button>
                </div>
                {editing && (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <TeamProfileEditor
                      card={{ id: c.id, name: c.name, position: c.position, publicTier: c.publicTier, bio: c.bio, image: c.image, email: c.email, order: c.order, visible: c.visible, updatedAt: c.updatedAt }}
                      onSaved={saved}
                      onDirtyChange={setDirty}
                    />
                    {dirty && <p className="mt-2 text-xs text-amber-600">Unsaved changes will be lost if you close this editor.</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this profile?"
        message={deleting ? `"${deleting.name}" is removed from the Meet the Team page. Nobody's account or access is affected.` : ''}
        confirmLabel="Delete profile"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const card = deleting
          if (!card) return
          void run(async () => {
            await apiRequest(`/api/team/${card.id}`, json('DELETE', { expectedUpdatedAt: card.updatedAt }))
            return 'Profile deleted.'
          }).then(() => setDeleting(null))
        }}
      />
    </section>
  )
}

// ── Order ───────────────────────────────────────────────────────────────────

function DisplayOrder({ dir, run, busy }: { dir: TeamDirectory; run: RunFn; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const cards = useMemo(() => {
    const linked = dir.members.flatMap((m) => (m.card ? [{ id: m.card.id, name: m.card.name, position: m.card.position, order: m.card.order, visible: m.card.visible, owner: m.email }] : []))
    const unowned = dir.unlinkedCards.map((c) => ({ id: c.id, name: c.name, position: c.position, order: c.order, visible: c.visible, owner: null as string | null }))
    return [...linked, ...unowned].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  }, [dir])

  const move = (index: number, delta: -1 | 1) => {
    const next = [...cards]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void run(async () => {
      await apiRequest('/api/admin/team-cards/reorder', json('POST', { ids: next.map((c) => c.id) }))
      return 'Display order saved.'
    })
  }

  return (
    <section aria-labelledby="order-heading" className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="order-heading" className="text-sm font-bold uppercase tracking-widest text-[var(--fg)]">Profile order</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--fg-muted)]">The order cards appear within their section of the Our Team page. Section and row still come from each public placement.</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`${buttonClass} border border-[var(--border-strong)] text-[var(--fg)]`}>{open ? 'Hide' : 'Reorder profiles'}</button>
      </div>
      {open && (
        <ol className="mt-3 divide-y divide-[var(--border)]">
          {cards.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-8 text-right text-xs text-[var(--fg-muted)]">{i + 1}</span>
              <span className="flex-1">
                <span className="font-semibold text-[var(--fg)]">{c.name}</span>
                <span className="ml-2 text-xs text-[var(--fg-muted)]">{c.position || 'No position'}{c.visible ? '' : ' · hidden'}</span>
              </span>
              <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.name} up`} className={`${buttonClass} min-w-[40px] border border-[var(--border)]`}>↑</button>
              <button type="button" disabled={busy || i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.name} down`} className={`${buttonClass} min-w-[40px] border border-[var(--border)]`}>↓</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
