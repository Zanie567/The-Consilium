'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Search, ChevronLeft, ChevronRight, MoreHorizontal, Eye, Shield,
  AlertTriangle, Ban, Trash2, Check, Users, Activity, Clock,
  ChevronDown, ShieldOff, Pencil,
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

const ACTION_LABELS: Record<string, string> = {
  USER_ROLE_CHANGED:       'Role changed',
  USER_WARNED:             'Warning issued',
  USER_BANNED:             'Account banned',
  USER_UNBANNED:           'Account unbanned',
  USER_DELETED:            'Account deleted',
  COMMENT_REMOVED_BY_ADMIN:'Comment removed',
}

const AVATAR_PALETTES = [
  { bg: '#1a2744', text: '#ffffff' },
  { bg: '#c9a84c', text: '#1a2744' },
  { bg: '#0f4c3f', text: '#ffffff' },
  { bg: '#8b4a2f', text: '#ffffff' },
  { bg: '#4a7c59', text: '#ffffff' },
]
function getAvatarPalette(name: string) {
  const code = (name || 'A').toUpperCase().charCodeAt(0) - 65
  return AVATAR_PALETTES[Math.abs(code) % 5]
}

const ROLE_BADGE_STYLES: Record<string, React.CSSProperties> = {
  ADMIN:  { background: '#1a2744', color: '#c9a84c' },
  EDITOR: { background: 'rgba(15,76,63,0.12)', color: '#0f4c3f' },
  WRITER: { background: 'rgba(201,168,76,0.15)', color: '#8a6a1a' },
  READER: { background: '#e8e4d9', color: '#666666' },
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon, value, label, context, accentColor, contextAmber }: {
  icon: React.ReactNode; value: number | string; label: string;
  context: string; accentColor: string; contextAmber?: boolean
}) {
  return (
    <div
      className="bg-white rounded-lg p-5 relative overflow-hidden hover:bg-[#faf8f0] transition-colors duration-150 cursor-default border border-[#e8e4d9]"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="absolute top-4 right-4 opacity-35" style={{ color: accentColor }}>
        {icon}
      </div>
      <p className="text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] mb-3">{label}</p>
      <p className="text-[36px] font-semibold text-[#1a2744] leading-none mb-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className={`text-[12px] ${contextAmber ? 'text-amber-500 font-medium' : 'text-[#888]'}`}>
        {context}
      </p>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const style = ROLE_BADGE_STYLES[role] ?? { background: '#e8e4d9', color: '#666666' }
  return (
    <span
      className="inline-block rounded-[4px] text-[11px] tracking-[0.05em] uppercase font-bold"
      style={{ ...style, padding: '3px 8px' }}
    >
      {role}
    </span>
  )
}

function StatusIndicator({ isBanned }: { isBanned: boolean }) {
  if (isBanned) {
    return (
      <span className="inline-flex items-center text-[11px] font-bold tracking-wide bg-red-500 text-white rounded-full px-2.5 py-0.5">
        Banned
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-600">
      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
      Active
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
        className="w-7 h-7 flex items-center justify-center text-[#999] hover:text-[#1a2744] hover:bg-[#f0ede6] rounded-[4px] transition-colors"
        aria-label="Actions"
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-[#e8e4d9] shadow-lg rounded-lg min-w-[168px] py-1 overflow-hidden">
          <button onClick={onView} className="w-full text-left h-8 px-3 text-[13px] text-[#1a2744] hover:bg-[#f5f2eb] flex items-center gap-2">
            <Eye size={12} /> View Profile
          </button>

          {/* Change role */}
          <div className="relative">
            <button
              onClick={() => setRoleOpen((o) => !o)}
              className="w-full text-left h-8 px-3 text-[13px] text-[#1a2744] hover:bg-[#f5f2eb] flex items-center gap-2"
            >
              <Shield size={12} /> Change Role <ChevronDown size={10} className="ml-auto" />
            </button>
            {roleOpen && (
              <div className="absolute left-full top-0 ml-1 bg-white border border-[#e8e4d9] shadow-lg rounded-lg min-w-[100px] py-1 overflow-hidden">
                {['ADMIN', 'EDITOR', 'WRITER', 'READER'].filter((r) => r !== user.role).map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRoleChange(r)}
                    className="w-full text-left h-8 px-3 text-[13px] text-[#1a2744] hover:bg-[#f5f2eb]"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { setOpen(false); onView() }}
            className="w-full text-left h-8 px-3 text-[13px] text-amber-600 hover:bg-amber-50 flex items-center gap-2"
          >
            <AlertTriangle size={12} /> Send Warning
          </button>

          <div className="my-1 border-t border-[#e8e4d9]" />

          {user.isBanned ? (
            <button
              onClick={() => doAction(`/api/admin/users/${user.id}/unban`, 'POST')}
              disabled={loading === `/api/admin/users/${user.id}/unban`}
              className="w-full text-left h-8 px-3 text-[13px] text-[#c0392b] hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
            >
              <Check size={12} /> Unban Account
            </button>
          ) : (
            <button
              onClick={() => { setOpen(false); onView() }}
              className="w-full text-left h-8 px-3 text-[13px] text-[#c0392b] hover:bg-red-50 flex items-center gap-2"
            >
              <Ban size={12} /> Ban Account
            </button>
          )}

          {user.role !== 'ADMIN' && (
            <button
              onClick={() => { setOpen(false); onView() }}
              className="w-full text-left h-8 px-3 text-[13px] text-[#c0392b] hover:bg-red-50 flex items-center gap-2"
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

  if (loading) return <div className="py-8 text-center text-[#888] text-xs">Loading audit log...</div>
  if (entries.length === 0) return (
    <div className="py-16 flex flex-col items-center gap-3">
      <Shield size={32} className="text-[#ccc]" />
      <p className="text-[15px] font-semibold text-[#1a2744]">No audit entries yet</p>
      <p className="text-[13px] text-[#888]">Admin actions will appear here.</p>
    </div>
  )

  return (
    <div className="bg-white rounded-lg border border-[#e8e4d9] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#e8e4d9]">
              <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">Action</th>
              <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">Target</th>
              <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden md:table-cell">Performed By</th>
              <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8e4d9]">
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
                <tr key={e.id} className="hover:bg-[#faf8f4] transition-colors duration-100" style={{ height: '56px' }}>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-[4px] ${
                      e.action.includes('BANNED') ? 'bg-red-50 text-red-500' :
                      e.action.includes('UNBANNED') ? 'bg-emerald-50 text-emerald-600' :
                      e.action.includes('WARNED') ? 'bg-amber-50 text-amber-600' :
                      e.action.includes('DELETED') ? 'bg-red-50 text-red-400' :
                      'bg-[#f0ede6] text-[#888]'
                    }`}>
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                    {detail && <p className="text-[#aaa] text-[10px] mt-0.5 line-clamp-1">{detail}</p>}
                  </td>
                  <td className="px-4 py-3 text-[#1a2744] text-[13px] font-mono">{target}</td>
                  <td className="px-4 py-3 text-[#888] text-[13px] hidden md:table-cell">{by}</td>
                  <td className="px-4 py-3 text-[#888] text-[12px] whitespace-nowrap">
                    {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  currentAdminId: string
}

const ROLE_TABS = ['All', 'Admin', 'Editor', 'Writer', 'Reader']
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

  const mainTabs = [
    { key: 'users' as MainTab, label: `All Users${stats ? ` (${stats.total.toLocaleString()})` : ''}` },
    { key: 'audit' as MainTab, label: 'Audit Log' },
  ]

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={<Users size={20} />}
            value={stats.total}
            label="Total Users"
            context="across all roles"
            accentColor="#1a2744"
          />
          <StatCard
            icon={<Activity size={20} />}
            value={stats.activeThisWeek}
            label="Active This Week"
            context="logged in last 7 days"
            accentColor="#16a34a"
          />
          <StatCard
            icon={<ShieldOff size={20} />}
            value={stats.banned}
            label="Banned"
            context={stats.banned === 0 ? 'no active suspensions' : `${stats.banned} suspended`}
            accentColor="#dc2626"
            contextAmber={stats.banned > 0}
          />
          <StatCard
            icon={<Pencil size={20} />}
            value={stats.staffCount}
            label="Writers & Above"
            context="admin, editor, writer roles"
            accentColor="#c9a84c"
          />
        </div>
      )}

      {/* Main tab nav — pill style */}
      <div className="flex items-center gap-1.5 mb-6">
        {mainTabs.map((t) => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[6px] transition-colors duration-150 ${
              mainTab === t.key
                ? 'bg-[#f0ede6] text-[#1a2744] border border-[#d0cdc5]/60'
                : 'text-[#888] hover:bg-[#f5f2eb] hover:text-[#1a2744]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {mainTab === 'audit' && <AuditLog />}

      {mainTab === 'users' && (
        <>
          {/* Filters */}
          <div className="space-y-3 mb-5">
            {/* Search */}
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#aaa] pointer-events-none" />
              <input
                type="search"
                placeholder="Search name or email..."
                defaultValue={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full h-[38px] bg-[#faf9f7] border border-[#d0cdc5] rounded-lg pl-9 pr-4 text-[13px] text-[#1a2744] placeholder:text-[#aaa] placeholder:italic outline-none focus:border-[#1a2744]/40 transition-colors"
              />
            </div>

            {/* Role tabs + status + sort */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Role filter pills */}
              <div className="flex gap-1">
                {ROLE_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRoleTab(tab)}
                    className={`h-8 px-3 text-[12px] font-medium rounded-[6px] transition-colors duration-150 ${
                      roleTab === tab
                        ? 'bg-[#1a2744] text-white'
                        : 'bg-transparent text-[#888] hover:bg-[#f0ede6] hover:text-[#1a2744]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="appearance-none h-9 bg-[#faf9f7] border border-[#d0cdc5] rounded-md text-[13px] text-[#1a2744] pl-3 pr-8 outline-none focus:border-[#1a2744]/40 transition-colors cursor-pointer"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="banned">Banned</option>
                  <option value="warned">Warned</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888] pointer-events-none" />
              </div>

              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="appearance-none h-9 bg-[#faf9f7] border border-[#d0cdc5] rounded-md text-[13px] text-[#1a2744] pl-3 pr-8 outline-none focus:border-[#1a2744]/40 transition-colors cursor-pointer"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888] pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg border border-[#e8e4d9] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e4d9]">
                    <th className="text-left px-4 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">User</th>
                    <th className="text-left px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">Role</th>
                    <th className="text-center px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden sm:table-cell">Articles</th>
                    <th className="text-center px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden md:table-cell">Comments</th>
                    <th className="text-center px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden lg:table-cell">Warnings</th>
                    <th className="text-left px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden lg:table-cell">Joined</th>
                    <th className="text-left px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em] hidden xl:table-cell">Last Active</th>
                    <th className="text-left px-3 py-3 text-[#999] text-[11px] font-semibold uppercase tracking-[0.07em]">Status</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8e4d9]">
                  {loading ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} style={{ height: '56px' }}>
                        <td colSpan={9} className="px-4 py-4">
                          <div className="h-4 bg-[#f0ede6] animate-pulse rounded w-3/4" />
                        </td>
                      </tr>
                    ))
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="py-16 flex flex-col items-center gap-3">
                          <Users size={32} className="text-[#ccc]" />
                          <p className="text-[15px] font-semibold text-[#1a2744]">No users found</p>
                          <p className="text-[13px] text-[#888]">Try adjusting your filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => {
                      const initials = (user.name || user.email).charAt(0).toUpperCase()
                      const palette = getAvatarPalette(user.name || user.email)
                      const lastActiveColor = (() => {
                        if (!user.lastActiveAt) return 'text-[#ccc]'
                        const diffDays = (Date.now() - new Date(user.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24)
                        if (diffDays < 7) return 'text-emerald-600'
                        if (diffDays < 30) return 'text-[#888]'
                        return 'text-[#bbb]'
                      })()
                      return (
                        <tr
                          key={user.id}
                          className="hover:bg-[#faf8f4] transition-colors duration-100 cursor-pointer"
                          style={{ height: '56px' }}
                          onClick={() => setSelectedUserId(user.id)}
                        >
                          {/* Avatar + name + email */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                style={{ background: palette.bg, color: palette.text }}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[#1a2744] font-semibold text-[13px] truncate">{user.name ?? '—'}</p>
                                <p className="text-[#888] text-[11px] truncate">{user.email}</p>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="px-3 py-3">
                            <RoleBadge role={user.role} />
                          </td>

                          {/* Articles */}
                          <td className="px-3 py-3 text-center hidden sm:table-cell">
                            <span className="text-[#1a2744] text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {user._count.articles === 0 ? <span className="text-[#ccc]">—</span> : user._count.articles}
                            </span>
                          </td>

                          {/* Comments */}
                          <td className="px-3 py-3 text-center hidden md:table-cell">
                            <span className="text-[#1a2744] text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {user._count.comments === 0 ? <span className="text-[#ccc]">—</span> : user._count.comments}
                            </span>
                          </td>

                          {/* Warnings */}
                          <td className="px-3 py-3 text-center hidden lg:table-cell">
                            {user._count.warnings === 0 ? (
                              <span className="text-[#ccc] text-[14px]">—</span>
                            ) : (
                              <span className="inline-flex items-center justify-center text-[11px] font-bold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 min-w-[1.5rem]">
                                {user._count.warnings}
                              </span>
                            )}
                          </td>

                          {/* Joined */}
                          <td className="px-3 py-3 text-[#888] text-[12px] whitespace-nowrap hidden lg:table-cell">
                            {format(new Date(user.createdAt), 'd MMM yyyy')}
                          </td>

                          {/* Last active */}
                          <td className="px-3 py-3 hidden xl:table-cell">
                            <span className={`flex items-center gap-1 text-[12px] ${lastActiveColor}`}>
                              <Clock size={11} />
                              {user.lastActiveAt
                                ? formatDistanceToNow(new Date(user.lastActiveAt), { addSuffix: true })
                                : 'Never'}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3">
                            <StatusIndicator isBanned={user.isBanned} />
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
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between px-4 py-3.5 border-t border-[#e8e4d9]">
                <p className="text-[#888] text-[13px]">Showing {start}–{end} of {total} users</p>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 px-3 text-[13px] text-[#1a2744] border border-[#d0cdc5] rounded-[6px] hover:border-[#1a2744]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  {pages > 1 && (
                    <span className="text-[12px] text-[#888] bg-[#f0ede6] rounded-full px-2.5 py-0.5">{page} / {pages}</span>
                  )}
                  <button
                    disabled={page === pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    className="h-8 px-3 text-[13px] text-[#1a2744] border border-[#d0cdc5] rounded-[6px] hover:border-[#1a2744]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    Next <ChevronRight size={14} />
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
