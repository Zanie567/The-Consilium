'use client'

import { useState, useCallback } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import Image from 'next/image'
import {
  Save, KeyRound, PowerOff, Mail, ExternalLink,
  ChevronLeft, Check, AlertCircle, Pencil, X,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

interface Category { id: string; name: string; slug: string }

interface ArticleItem {
  id: string
  title: string
  slug: string
  status: string
  createdAt: string
  publishedAt: string | null
  category: { name: string } | null
}

interface UserData {
  id: string
  name: string | null
  email: string
  role: 'ADMIN' | 'EDITOR' | 'WRITER' | 'GROWTH' | 'READER'
  isActive: boolean
  slug: string | null
  bio: string | null
  image: string | null
  createdAt: string
  lastLoginAt: string | null
  adminNotes: string | null
  categoryAssignments: { category: Category }[]
  articles: ArticleItem[]
}

interface Props {
  user: UserData
  categories: Category[]
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  PENDING_REVIEW: 'bg-amber-500/10 text-amber-600',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-600',
  SCHEDULED: 'bg-blue-500/10 text-blue-600',
  REJECTED: 'bg-red-500/10 text-red-600',
  ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
}

const ROLE_OPTIONS = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] as const

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 px-4 py-3 shadow-xl text-xs font-semibold ${
      ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
    }`}>
      {ok ? <Check size={14} /> : <AlertCircle size={14} />}
      {msg}
    </div>
  )
}

// ── Inline editable field ──────────────────────────────────────────────────────
function EditableField({
  label,
  value,
  onSave,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onSave: (v: string) => Promise<void>
  type?: string
  hint?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
    setEditing(false)
  }

  const cancel = () => { setDraft(value); setEditing(false) }

  return (
    <div>
      <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-wider mb-1">{label}</p>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
            autoFocus
            className="flex-1 bg-[var(--bg)] border border-gold/60 px-3 py-1.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold"
          />
          <button onClick={save} disabled={saving} aria-label="Save" className="p-1.5 text-emerald-600 hover:text-emerald-500 transition-colors disabled:opacity-60">
            <Save size={14} />
          </button>
          <button onClick={cancel} aria-label="Cancel" className="p-1.5 text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 group">
          <p className="text-[var(--fg)] text-sm flex-1 break-all">{value || <span className="text-[var(--fg-faint)] italic">Not set</span>}</p>
          {hint && <p className="text-[var(--fg-faint)] text-[10px]">{hint}</p>}
          <button
            onClick={() => { setDraft(value); setEditing(true) }}
            aria-label={`Edit ${label}`}
            className="opacity-0 group-hover:opacity-100 p-1 text-[var(--fg-faint)] hover:text-gold transition-all"
          >
            <Pencil size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function UserProfileEditor({ user: initial, categories }: Props) {
  const [user, setUser] = useState(initial)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [adminNotes, setAdminNotes] = useState(initial.adminNotes ?? '')
  const [notesDirty, setNotesDirty] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showPwReset, setShowPwReset] = useState(false)
  const [selectedCats, setSelectedCats] = useState<string[]>(
    initial.categoryAssignments.map((a) => a.category.id)
  )

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const patch = useCallback(async (data: Record<string, unknown>, loadingKey = 'save') => {
    setLoading(loadingKey)
    const res = await fetch(`/api/editorial/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await res.json()
    setLoading(null)
    if (!res.ok) { showToast(result.error ?? 'Save failed.', false); return null }
    setUser((prev) => ({ ...prev, ...result }))
    showToast('Saved.')
    return result
  }, [user.id])

  const saveField = (key: string) => async (value: string) => {
    await patch({ [key]: value })
  }

  const saveRole = async (role: string) => {
    await patch({ role }, 'role')
  }

  const saveCategories = async (ids: string[]) => {
    setLoading('cats')
    const res = await fetch(`/api/editorial/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryIds: ids }),
    })
    setLoading(null)
    if (res.ok) {
      setSelectedCats(ids)
      showToast('Categories updated.')
    }
  }

  const toggleActive = async () => {
    await patch({ isActive: !user.isActive }, 'active')
  }

  const resetPassword = async () => {
    if (newPassword.length < 8) { showToast('Password must be at least 8 characters.', false); return }
    await patch({ password: newPassword }, 'pw')
    setNewPassword('')
    setShowPwReset(false)
  }

  const sendResetEmail = async () => {
    setLoading('email')
    const res = await fetch('/api/editorial/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    })
    setLoading(null)
    showToast(res.ok ? 'Reset email sent.' : 'Failed to send email.', res.ok)
  }

  const saveNotes = async () => {
    await patch({ adminNotes }, 'notes')
    setNotesDirty(false)
  }

  const authorSlug = user.slug ?? user.id
  const initials = user.name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? '?'

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[var(--fg-faint)] mb-6">
        <Link href="/editorial/users" className="flex items-center gap-1 hover:text-gold transition-colors">
          <ChevronLeft size={13} />
          User Management
        </Link>
        <span>/</span>
        <span className="text-[var(--fg)]">{user.name ?? user.email}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT COLUMN: Profile ──────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">

          {/* Photo + name card */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-6 text-center">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name ?? ''}
                width={88}
                height={88}
                className="rounded-full object-cover ring-2 ring-gold/30 mx-auto mb-4"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-navy flex items-center justify-center mx-auto mb-4 ring-2 ring-gold/20">
                <span className="text-gold text-2xl font-bold" style={{ fontFamily: 'var(--font-serif)' }}>
                  {initials}
                </span>
              </div>
            )}
            <p
              className="text-[var(--fg)] font-bold text-lg leading-tight mb-0.5"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {user.name}
            </p>
            <p className="text-[var(--fg-faint)] text-xs">{user.email}</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 ${user.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                {user.isActive ? 'Active' : 'Deactivated'}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 bg-gold/10 text-gold">
                {user.role}
              </span>
            </div>
          </div>

          {/* Profile fields */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 space-y-4">
            <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest">
              Profile Details
            </p>
            <EditableField label="Full Name" value={user.name ?? ''} onSave={saveField('name')} />
            <EditableField label="Email Address" value={user.email} onSave={saveField('email')} type="email" />
            <EditableField
              label="Author Page Slug"
              value={user.slug ?? ''}
              onSave={saveField('slug')}
              hint={`/author/${authorSlug}`}
            />
            <div>
              <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-wider mb-1">Photo URL</p>
              <EditableField label="Photo URL" value={user.image ?? ''} onSave={saveField('image')} />
            </div>

            {/* Role selector */}
            <div>
              <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-wider mb-1.5">Role</p>
              <select
                value={user.role}
                onChange={(e) => saveRole(e.target.value)}
                disabled={loading === 'role'}
                className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[var(--fg)] text-sm focus:outline-none focus:border-gold disabled:opacity-60"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Category assignments (editor only) */}
            {(user.role === 'EDITOR' || user.role === 'ADMIN') && categories.length > 0 && (
              <div>
                <p className="text-[var(--fg-faint)] text-[10px] uppercase tracking-wider mb-2">
                  Assigned Categories
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {categories.map((cat) => (
                    <label key={cat.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCats.includes(cat.id)}
                        onChange={(e) => {
                          setSelectedCats((prev) =>
                            e.target.checked ? [...prev, cat.id] : prev.filter((id) => id !== cat.id)
                          )
                        }}
                        className="accent-gold"
                      />
                      <span className="text-xs text-[var(--fg-muted)]">{cat.name}</span>
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => saveCategories(selectedCats)}
                  disabled={loading === 'cats'}
                  className="text-xs text-gold hover:underline disabled:opacity-60"
                >
                  {loading === 'cats' ? 'Saving…' : 'Save categories'}
                </button>
              </div>
            )}
          </div>

          {/* Bio */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5">
            <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-3">
              Bio
            </p>
            <textarea
              value={user.bio ?? ''}
              onChange={(e) => setUser((prev) => ({ ...prev, bio: e.target.value }))}
              onBlur={() => { if ((user.bio ?? '') !== (initial.bio ?? '')) saveField('bio')(user.bio ?? '') }}
              rows={4}
              placeholder="Short biography shown on their public author page…"
              className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold resize-none"
            />
            <p className="text-[var(--fg-faint)] text-[10px] mt-1.5">Changes save when you click away.</p>
          </div>

          {/* Account actions */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 space-y-3">
            <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-1">
              Account Actions
            </p>

            {/* Active toggle */}
            <Tooltip
              content={user.isActive
                ? 'Deactivate this account: the user will be logged out immediately and will not be able to log back in'
                : 'Reactivate this account and restore the user\'s access to the editorial portal'}
              variant="editorial"
              side="right"
              maxWidth={300}
            >
              <button
                onClick={toggleActive}
                disabled={loading === 'active'}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-60 ${
                  user.isActive
                    ? 'border border-amber-500/40 text-amber-600 hover:bg-amber-500/10'
                    : 'border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10'
                }`}
              >
                <PowerOff size={13} />
                {loading === 'active' ? 'Updating…' : user.isActive ? 'Deactivate Account' : 'Reactivate Account'}
              </button>
            </Tooltip>

            {/* Send password reset email */}
            <Tooltip content="Send this user an email with a password reset link" variant="editorial" side="right">
              <button
                onClick={sendResetEmail}
                disabled={loading === 'email'}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors disabled:opacity-60"
              >
                <Mail size={13} />
                {loading === 'email' ? 'Sending…' : 'Send Password Reset Email'}
              </button>
            </Tooltip>

            {/* Set password directly */}
            <Tooltip content="Set a new password directly for this account" variant="editorial" side="right">
              <button
                onClick={() => setShowPwReset((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors"
              >
                <KeyRound size={13} />
                Set Password Directly
              </button>
            </Tooltip>
            {showPwReset && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] px-3 py-1.5 text-[var(--fg)] text-xs focus:outline-none focus:border-gold"
                />
                <button
                  onClick={resetPassword}
                  disabled={loading === 'pw'}
                  className="bg-navy text-gold px-3 py-1.5 text-xs font-bold hover:bg-navy-dark transition-colors disabled:opacity-60"
                >
                  {loading === 'pw' ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {/* View author page */}
            <a
              href={`/author/${authorSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border border-[var(--border)] text-[var(--fg-muted)] hover:border-gold hover:text-gold transition-colors"
            >
              <ExternalLink size={13} />
              View Public Author Page
            </a>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Articles + Activity ─────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Articles */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest">
                Articles
              </p>
              <span className="text-[var(--fg-faint)] text-xs">{user.articles.length} total</span>
            </div>
            {user.articles.length === 0 ? (
              <p className="px-5 py-10 text-center text-[var(--fg-faint)] text-sm">No articles yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wider">Title</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden sm:table-cell">Category</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden md:table-cell">Submitted</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wider hidden lg:table-cell">Published</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {user.articles.map((a) => (
                    <tr key={a.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-5 py-3">
                        <Link
                          href={`/editorial/articles/${a.id}/edit`}
                          className="text-[var(--fg)] hover:text-gold transition-colors text-xs font-medium line-clamp-1"
                        >
                          {a.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                        {a.category?.name ?? 'Uncategorised'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 ${STATUS_STYLE[a.status] ?? ''}`}>
                          {a.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">
                        {format(new Date(a.createdAt), 'd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden lg:table-cell">
                        {a.publishedAt ? format(new Date(a.publishedAt), 'd MMM yyyy') : 'Not published'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Activity log */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5">
            <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest mb-4">
              Activity
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Account created</span>
                <span className="text-[var(--fg-faint)]">{format(new Date(user.createdAt), 'd MMM yyyy')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Last login</span>
                <span className="text-[var(--fg-faint)]">
                  {user.lastLoginAt ? format(new Date(user.lastLoginAt), 'd MMM yyyy, HH:mm') : 'Never recorded'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Articles submitted</span>
                <span className="text-[var(--fg-faint)]">{user.articles.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--fg-muted)]">Articles published</span>
                <span className="text-[var(--fg-faint)]">
                  {user.articles.filter((a) => a.status === 'PUBLISHED').length}
                </span>
              </div>
              {user.articles.length > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--fg-muted)]">Last article submitted</span>
                  <span className="text-[var(--fg-faint)]">
                    {format(new Date(user.articles[0].createdAt), 'd MMM yyyy')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Admin notes */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[0.65rem] font-bold text-[var(--fg-faint)] uppercase tracking-widest">
                Admin Notes
              </p>
              <p className="text-[var(--fg-faint)] text-[10px]">Visible only to admins</p>
            </div>
            <textarea
              value={adminNotes}
              onChange={(e) => { setAdminNotes(e.target.value); setNotesDirty(true) }}
              rows={4}
              placeholder="Private notes about this account (e.g. availability, communication preferences, issues)…"
              className="w-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 text-[var(--fg)] text-sm focus:outline-none focus:border-gold resize-none"
            />
            {notesDirty && (
              <button
                onClick={saveNotes}
                disabled={loading === 'notes'}
                className="mt-2 flex items-center gap-2 bg-navy text-gold px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-60"
              >
                <Save size={12} />
                {loading === 'notes' ? 'Saving…' : 'Save Notes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
