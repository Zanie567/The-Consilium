'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Search, ChevronLeft, ChevronRight, MoreHorizontal, Eye, Shield,
  AlertTriangle, Ban, Trash2, Check, Users, Activity, BookOpen, Clock,
  ChevronDown,
} from 'lucide-react'
import { UserDetailPanel } from './UserDetailPanel'

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  name: string | null
  email: string
  role: string
  isActive: boolean
  isBanned: boolean
  bannedAt: string | null
  bannedReason: string | null
  createdAt: string
  lastActiveAt: string | null
  _count: {
    articles: number
    comments: number
    warnings: number
    debateVotes: number
  }
}

interface Stats {
  total: number
  activeThisWeek: number
  banned: number
  staffCount: number
}

interface AuditEntry {
  id: string
  action: string
  targetId: string
  targetType: string
  performedBy: string
  metadata: Record<string, string> | null
  createdAt: string
}

const ROLE_COLOURS: Record<string, string> = {
  ADMIN:  'bg-navy text-gold border border-gold/30',
  EDITOR: 'bg-teal-800/80 text-teal-200',
  WRITER: 'bg-gold/20 text-gold',
  GROWTH: 'bg-emerald-800/60 text-emerald-300',
  READER: 'bg-[var(--border)] text-[var(--fg-muted)]',
}

const ACTION_LABELS: Record<string, string> = {
  USER_ROLE_CHANGED:       'Role changed',
  USER_WARNED:             'Warning issued',
  USER_BANNED:             'Account banned',
  USER_UNBANNED:           'Account unbanned',
  USER_DELETED:            'Account deleted',
  COMMENT_REMOVED_BY_ADMIN:'Comment removed',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-gold/60">{icon}</span>
        <p className="text-[var(--fg-faint)] text-xs font-bold uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-3xl font-bold text-[var(--fg)]">{value.toLocaleString()}</p>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${ROLE_COLOURS[role] ?? ''}`}>
      {role}
    </span>
  )
}

function StatusDot({ isBanned }: { isBanned: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${
      isBanned ? 'bg-red-500/15 text-red-500' : 'bg-green-500/15 text-green-500'
    }`}>
      {isBanned ? 'Banned' : 'Active'}
    </span>
  )
}

// Three-dot action menu
function ActionMenu({
  user,
  currentAdminId,
  onView,
  onReload,
}: {
  user: UserRow
  currentAdminId: string
  onView: () => void
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [loading, setLoading] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setRoleOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isSelf = user.id === currentAdminId

  const doAction = async (endpoint: string, method: string, body?: object) => {
    setLoading(endpoint)
    const res = await fetch(endpoint, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setLoading('')
    setOpen(false)
    if (res.ok) onReload()
  }

  const handleRoleChange = (role: string) => {
    doAction(`/api/admin/users/${user.id}/role`, 'PATCH', { role })
    setRoleOpen(false)
  }

  if (isSelf) return null

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--border)] transition-colors rounded"
        aria-label="Actions"
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl min-w-[160px] py-1">
          <button onClick={onView} className="w-full text-left px-4 py-2 text-xs text-[var(--fg)] hover:bg-gold/10 hover:text-gold flex items-center gap-2">
            <Eye size={12} /> View Profile
          </button>

          {/* Change role */}
          <div className="relative">
            <button
              onClick={() => setRoleOpen((o) => !o)}
              className="w-full text-left px-4 py-2 text-xs text-[var(--fg)] hover:bg-gold/10 hover:text-gold flex items-center gap-2"
            >
              <Shield size={12} /> Change Role <ChevronDown size={10} className="ml-auto" />
            </button>
            {roleOpen && (
              <div className="absolute right-full top-0 mr-1 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl min-w-[100px] py-1">
                {['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'].filter((r) => r !== user.role).map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRoleChange(r)}
                    className="w-full text-left px-4 py-2 text-xs text-[var(--fg)] hover:bg-gold/10 hover:text-gold"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { setOpen(false); onView() }}
            className="w-full text-left px-4 py-2 text-xs text-amber-500 hover:bg-amber-500/10 flex items-center gap-2"
          >
            <AlertTriangle size={12} /> Send Warning
          </button>

          {user.isBanned ? (
            <button
              onClick={() => doAction(`/api/admin/users/${user.id}/unban`, 'POST')}
              disabled={loading === `/api/admin/users/${user.id}/unban`}
              className="w-full text-left px-4 py-2 text-xs text-green-500 hover:bg-green-500/10 flex items-center gap-2 disabled:opacity-50"
            >
              <Check size={12} /> Unban Account
            </button>
          ) : (
            <button
              onClick={() => { setOpen(false); onView() }}
              className="w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2"
            >
              <Ban size={12} /> Ban Account
            </button>
          )}

          {['EDITOR', 'WRITER', 'GROWTH', 'READER'].includes(user.role) && (
            <button
              onClick={() => { setOpen(false); onView() }}
              className="w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2 border-t border-[var(--border)] mt-1 pt-2"
            >
              <Trash2 size={12} /> Delete Account
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/audit-log')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setEntries(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-8 text-center text-[var(--fg-faint)] text-xs">Loading audit log...</div>
  if (entries.length === 0) return <div className="py-8 text-center text-[var(--fg-faint)] text-xs">No audit entries yet.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-bold uppercase tracking-widest text-[10px]">Action</th>
            <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-bold uppercase tracking-widest text-[10px]">Target</th>
            <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-bold uppercase tracking-widest text-[10px] hidden md:table-cell">Performed By</th>
            <th className="text-left px-4 py-3 text-[var(--fg-faint)] font-bold uppercase tracking-widest text-[10px]">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {entries.map((e) => {
            const meta = e.metadata ?? {}
            const target = meta.targetEmail ?? meta.deletedEmail ?? e.targetId.slice(0, 8) + '...'
            const by = meta.adminName ?? e.performedBy.slice(0, 8) + '...'
            const detail = e.action === 'USER_ROLE_CHANGED' && meta.oldRole && meta.newRole
              ? `${meta.oldRole} → ${meta.newRole}`
              : meta.reason
                ? meta.reason.slice(0, 60) + (meta.reason.length > 60 ? '…' : '')
                : ''

            return (
              <tr key={e.id} className="hover:bg-[var(--bg)] transition-colors">
                <td className="px-4 py-3">
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 ${
                    e.action.includes('BANNED') ? 'bg-red-500/15 text-red-500' :
                    e.action.includes('UNBANNED') ? 'bg-green-500/15 text-green-500' :
                    e.action.includes('WARNED') ? 'bg-amber-500/15 text-amber-500' :
                    e.action.includes('DELETED') ? 'bg-red-500/15 text-red-400' :
                    'bg-[var(--border)] text-[var(--fg-muted)]'
                  }`}>
                    {ACTION_LABELS[e.action] ?? e.action}
                  </span>
                  {detail && <p className="text-[var(--fg-faint)] text-[9px] mt-0.5 line-clamp-1">{detail}</p>}
                </td>
                <td className="px-4 py-3 text-[var(--fg)] font-mono">{target}</td>
                <td className="px-4 py-3 text-[var(--fg-muted)] hidden md:table-cell">{by}</td>
                <td className="px-4 py-3 text-[var(--fg-faint)] whitespace-nowrap">
                  {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  currentAdminId: string
}

const ROLE_TABS = ['All', 'Admin', 'Editor', 'Writer', 'Growth', 'Reader']
const SORT_OPTIONS = [
  { value: 'createdAt',    label: 'Newest' },
  { value: 'oldest',       label: 'Oldest' },
  { value: 'articleCount', label: 'Most articles' },
  { value: 'commentCount', label: 'Most comments' },
  { value: 'lastActive',   label: 'Last active' },
]

type MainTab = 'users' | 'audit'

export function AdminUsersPage({ currentAdminId }: Props) {
  const [mainTab, setMainTab] = useState<MainTab>('users')
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)

  // Filters
  const [search, setSearch] = useState('')
  const [roleTab, setRoleTab] = useState('All')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('createdAt')

  // Panel
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadStats = () => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {})
  }

  const loadUsers = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      limit: '25',
      sort,
      ...(search && { search }),
      ...(roleTab !== 'All' && { role: roleTab.toUpperCase() }),
      ...(status && { status }),
    })
    fetch(`/api/admin/users?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setUsers(d.users ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, sort, search, roleTab, status])

  useEffect(() => { loadStats() }, [])
  useEffect(() => { loadUsers() }, [loadUsers])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [search, roleTab, status, sort])

  const handleSearchChange = (val: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(val), 300)
  }

  const handleReload = () => { loadStats(); loadUsers() }

  const start = (page - 1) * 25 + 1
  const end = Math.min(page * 25, total)

  return (
    <div>
      {/* Stats bar (skeleton placeholders while the counts load) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {stats ? (
          <>
            <StatCard icon={<Users size={16} />}    value={stats.total}          label="Total Users" />
            <StatCard icon={<Activity size={16} />} value={stats.activeThisWeek} label="Active This Week" />
            <StatCard icon={<Ban size={16} />}       value={stats.banned}         label="Banned" />
            <StatCard icon={<BookOpen size={16} />} value={stats.staffCount}     label="Writers & Above" />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 animate-pulse">
              <div className="h-3 w-24 bg-[var(--border)] rounded mb-3" />
              <div className="h-8 w-16 bg-[var(--border)] rounded" />
            </div>
          ))
        )}
      </div>

      {/* Main tab nav */}
      <div className="flex gap-0 border-b border-[var(--border)] mb-6">
        <button
          onClick={() => setMainTab('users')}
          className={`px-5 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${mainTab === 'users' ? 'border-gold text-gold' : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'}`}
        >
          All Users
        </button>
        <button
          onClick={() => setMainTab('audit')}
          className={`px-5 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${mainTab === 'audit' ? 'border-gold text-gold' : 'border-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'}`}
        >
          Audit Log
        </button>
      </div>

      {mainTab === 'audit' && <AuditLog />}

      {mainTab === 'users' && (
        <>
          {/* Filters */}
          <div className="space-y-3 mb-5">
            {/* Search */}
            <div className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2.5 max-w-md">
              <Search size={14} className="text-[var(--fg-faint)] shrink-0" />
              <input
                type="search"
                placeholder="Search name or email..."
                defaultValue={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="flex-1 bg-transparent text-sm text-[var(--fg)] placeholder-[var(--fg-faint)] outline-none"
              />
            </div>

            {/* Role tabs + status + sort */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Role tabs */}
              <div className="flex gap-0 border border-[var(--border)]">
                {ROLE_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRoleTab(tab)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                      roleTab === tab
                        ? 'bg-gold text-navy'
                        : 'text-[var(--fg-faint)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 outline-none"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="banned">Banned</option>
                <option value="warned">Warned</option>
              </select>

              {/* Sort */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--fg)] text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-4 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest">User</th>
                    <th className="text-left px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest">Role</th>
                    <th className="text-center px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest hidden sm:table-cell">Articles</th>
                    <th className="text-center px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest hidden md:table-cell">Comments</th>
                    <th className="text-center px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest hidden lg:table-cell">Warnings</th>
                    <th className="text-left px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest hidden lg:table-cell">Joined</th>
                    <th className="text-left px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest hidden xl:table-cell">Last Active</th>
                    <th className="text-left px-3 py-3 text-[var(--fg-faint)] text-[10px] font-bold uppercase tracking-widest">Status</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {loading ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <tr key={i}>
                        <td colSpan={9} className="px-4 py-4">
                          <div className="h-4 bg-[var(--border)] animate-pulse rounded w-3/4" />
                        </td>
                      </tr>
                    ))
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-[var(--fg-faint)] text-sm">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr
                        key={user.id}
                        className="hover:bg-[var(--bg)] transition-colors cursor-pointer"
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        {/* Avatar + name + email */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-xs font-bold shrink-0">
                              {(user.name || user.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[var(--fg)] font-semibold text-xs truncate">{user.name ?? '-'}</p>
                              <p className="text-[var(--fg-faint)] text-[10px] truncate">{user.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-3 py-3">
                          <RoleBadge role={user.role} />
                        </td>

                        {/* Articles */}
                        <td className="px-3 py-3 text-center text-[var(--fg-muted)] text-xs hidden sm:table-cell">
                          {user._count.articles}
                        </td>

                        {/* Comments */}
                        <td className="px-3 py-3 text-center text-[var(--fg-muted)] text-xs hidden md:table-cell">
                          {user._count.comments}
                        </td>

                        {/* Warnings */}
                        <td className="px-3 py-3 text-center hidden lg:table-cell">
                          <span className={`text-xs font-bold ${user._count.warnings > 0 ? 'text-amber-500' : 'text-[var(--fg-faint)]'}`}>
                            {user._count.warnings}
                          </span>
                        </td>

                        {/* Joined */}
                        <td className="px-3 py-3 text-[var(--fg-faint)] text-[10px] whitespace-nowrap hidden lg:table-cell">
                          {format(new Date(user.createdAt), 'd MMM yyyy')}
                        </td>

                        {/* Last active */}
                        <td className="px-3 py-3 text-[var(--fg-faint)] text-[10px] hidden xl:table-cell">
                          <span className="flex items-center gap-1">
                            <Clock size={9} />
                            {user.lastActiveAt
                              ? formatDistanceToNow(new Date(user.lastActiveAt), { addSuffix: true })
                              : 'Never'}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3">
                          <StatusDot isBanned={user.isBanned} />
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <ActionMenu
                            user={user}
                            currentAdminId={currentAdminId}
                            onView={() => setSelectedUserId(user.id)}
                            onReload={handleReload}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                <p className="text-[var(--fg-faint)] text-xs">
                  Showing {start} to {end} of {total} users
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 text-[var(--fg-faint)] hover:text-gold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-[var(--fg-faint)] text-xs">{page} / {pages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="p-1.5 text-[var(--fg-faint)] hover:text-gold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* User detail panel */}
      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onUserUpdated={handleReload}
          currentAdminId={currentAdminId}
        />
      )}
    </div>
  )
}
