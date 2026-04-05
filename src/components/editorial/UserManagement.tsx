'use client'

import { useState, Fragment } from 'react'
import { format } from 'date-fns'
import { Plus, KeyRound, PowerOff, Trash2, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/Tooltip'

interface Category {
  id: string
  name: string
  slug: string
}

interface UserRecord {
  id: string
  name: string | null
  email: string
  role: 'ADMIN' | 'EDITOR' | 'WRITER'
  isActive: boolean
  createdAt: string
  categoryAssignments: { category: Category }[]
}

interface Props {
  initialUsers: UserRecord[]
  categories: Category[]
}

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-gold/20 text-gold',
  EDITOR: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  WRITER: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
}

export function UserManagement({ initialUsers, categories }: Props) {
  const [users, setUsers] = useState<UserRecord[]>(initialUsers)
  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({
    name: '', email: '', password: '', role: 'WRITER' as UserRecord['role'],
    categoryIds: [] as string[], bio: '', slug: '',
  })
  const [resetId, setResetId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const flash = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(''), 3000)
  }

  const createUser = async () => {
    setError('')
    if (!newUser.name || !newUser.email || !newUser.password) {
      setError('Name, email and password are required.')
      return
    }
    setLoading('create')
    const res = await fetch('/api/editorial/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    })
    const data = await res.json()
    setLoading(null)
    if (!res.ok) { setError(data.error ?? 'Failed to create user.'); return }
    setUsers((prev) => [...prev, { ...data, createdAt: new Date().toISOString(), categoryAssignments: [] }])
    setNewUser({ name: '', email: '', password: '', role: 'WRITER', categoryIds: [], bio: '', slug: '' })
    setShowCreate(false)
    flash(`${data.name} created successfully.`)
  }

  const toggleActive = async (id: string, current: boolean) => {
    setLoading(id + '-active')
    const res = await fetch(`/api/editorial/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    setLoading(null)
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, isActive: !current } : u))
      flash(!current ? 'Account activated.' : 'Account deactivated.')
    }
  }

  const resetPassword = async (id: string) => {
    if (!newPassword || newPassword.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(id + '-reset')
    const res = await fetch(`/api/editorial/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    setLoading(null)
    if (res.ok) {
      setResetId(null)
      setNewPassword('')
      flash('Password updated.')
    }
  }

  const deleteUser = async (id: string) => {
    if (!confirm('Delete this user? This cannot be undone.')) return
    setLoading(id + '-delete')
    const res = await fetch(`/api/editorial/users/${id}`, { method: 'DELETE' })
    setLoading(null)
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id))
      flash('User deleted.')
    }
  }

  return (
    <div className="space-y-6">
      {success && (
        <p className="text-emerald-600 text-sm bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
          {success}
        </p>
      )}
      {error && (
        <p className="text-red-500 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[var(--fg-faint)] text-sm">{users.length} editorial team members</p>
        <Tooltip content="Create a new writer, editor, or admin account" variant="editorial" side="left">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 bg-navy text-gold px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
          >
            <Plus size={14} />
            Create Account
          </button>
        </Tooltip>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[var(--bg-elevated)] border border-gold/20 p-6 space-y-4">
          <p className="text-sm font-bold text-[var(--fg)] uppercase tracking-widest mb-2">
            New Account
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
                Full Name *
              </label>
              <input
                type="text"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
                Email *
              </label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
                Temporary Password *
              </label>
              <input
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
                placeholder="Share privately with user"
              />
            </div>
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
                Role *
              </label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRecord['role'] })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
              >
                <option value="WRITER">Writer</option>
                <option value="EDITOR">Editor</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
                Author Page Slug
              </label>
              <input
                type="text"
                value={newUser.slug}
                onChange={(e) => setNewUser({ ...newUser, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
                placeholder="jane-smith (auto-generated if blank)"
              />
              <p className="text-[var(--fg-faint)] text-[10px] mt-1">
                Public URL: /author/{newUser.slug || 'jane-smith'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-1.5">
              Bio (optional)
            </label>
            <textarea
              value={newUser.bio}
              onChange={(e) => setNewUser({ ...newUser, bio: e.target.value })}
              rows={2}
              className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold resize-none"
              placeholder="Short biography shown on their author page..."
            />
          </div>

          {newUser.role === 'EDITOR' && categories.length > 0 && (
            <div>
              <label className="block text-[var(--fg-faint)] text-xs uppercase tracking-wider mb-2">
                Assigned Categories (leave blank for all)
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <label key={cat.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newUser.categoryIds.includes(cat.id)}
                      onChange={(e) => {
                        setNewUser((prev) => ({
                          ...prev,
                          categoryIds: e.target.checked
                            ? [...prev.categoryIds, cat.id]
                            : prev.categoryIds.filter((id) => id !== cat.id),
                        }))
                      }}
                      className="accent-gold"
                    />
                    <span className="text-xs text-[var(--fg-muted)]">{cat.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={createUser}
              disabled={loading === 'create'}
              className="bg-gold text-navy px-5 py-2 text-xs font-bold uppercase tracking-widest hover:bg-gold/90 transition-colors disabled:opacity-60"
            >
              {loading === 'create' ? 'Creating…' : 'Create Account'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="border border-[var(--border)] text-[var(--fg-muted)] px-5 py-2 text-xs font-bold uppercase tracking-widest hover:border-[var(--fg)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
              <th className="px-5 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden sm:table-cell">
                Role
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden md:table-cell">
                Joined
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden lg:table-cell">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[var(--fg-faint)] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr className={`hover:bg-[var(--bg-subtle)] transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/editorial/users/${u.id}`}
                      className="font-medium text-[var(--fg)] text-sm hover:text-gold transition-colors"
                    >
                      {u.name ?? u.email}
                    </Link>
                    <p className="text-[var(--fg-faint)] text-xs">{u.email}</p>
                    {u.categoryAssignments.length > 0 && (
                      <p className="text-[var(--fg-faint)] text-[10px] mt-0.5">
                        {u.categoryAssignments.map((a) => a.category.name).join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`text-xs font-bold px-2 py-0.5 ${ROLE_BADGE[u.role] ?? ''}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">
                    {format(new Date(u.createdAt), 'd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className={`text-xs font-bold ${u.isActive ? 'text-emerald-600' : 'text-[var(--fg-faint)]'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip
                        content="View their public author page"
                        variant="editorial"
                        side="top"
                      >
                        <Link
                          href={`/author/${u.id}`}
                          target="_blank"
                          className="p-1.5 text-[var(--fg-faint)] hover:text-gold transition-colors"
                          aria-label="View author page"
                        >
                          <ExternalLink size={14} />
                        </Link>
                      </Tooltip>
                      <Tooltip
                        content="Set a new password for this account"
                        variant="editorial"
                        side="top"
                      >
                        <button
                          onClick={() => { setResetId(resetId === u.id ? null : u.id); setNewPassword('') }}
                          aria-label="Reset password"
                          className="p-1.5 text-[var(--fg-faint)] hover:text-gold transition-colors"
                        >
                          <KeyRound size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip
                        content={u.isActive
                          ? 'Deactivate this account — the user will be logged out immediately and will not be able to log back in'
                          : 'Reactivate this account and restore the user\'s access to the editorial portal'}
                        variant="editorial"
                        side="top"
                        maxWidth={300}
                      >
                        <button
                          onClick={() => toggleActive(u.id, u.isActive)}
                          disabled={loading === u.id + '-active'}
                          aria-label={u.isActive ? 'Deactivate account' : 'Activate account'}
                          className={`p-1.5 transition-colors ${u.isActive ? 'text-[var(--fg-faint)] hover:text-amber-500' : 'text-amber-500 hover:text-emerald-600'}`}
                        >
                          <PowerOff size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip
                        content="Permanently delete this account and all their data. This cannot be undone."
                        variant="editorial"
                        side="top"
                        maxWidth={280}
                      >
                        <button
                          onClick={() => deleteUser(u.id)}
                          disabled={loading === u.id + '-delete'}
                          aria-label="Delete user"
                          className="p-1.5 text-[var(--fg-faint)] hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
                {resetId === u.id && (
                  <tr>
                    <td colSpan={5} className="px-5 py-3 bg-[var(--bg-subtle)]">
                      <div className="flex items-center gap-3">
                        <input
                          type="text"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password (min. 8 chars)"
                          className="flex-1 bg-[var(--bg)] border border-[var(--border)] px-3 py-1.5 text-[var(--fg)] text-xs focus:outline-none focus:border-gold"
                        />
                        <button
                          onClick={() => resetPassword(u.id)}
                          disabled={loading === u.id + '-reset'}
                          className="bg-navy text-gold px-4 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60"
                        >
                          {loading === u.id + '-reset' ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setResetId(null)}
                          className="text-[var(--fg-faint)] text-xs hover:text-[var(--fg)] transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
