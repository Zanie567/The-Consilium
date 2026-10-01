'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, Trash2, Edit, Check, X, Upload } from 'lucide-react'
import Image from 'next/image'
import { apiRequest, asApiError } from '@/lib/apiClient'

interface TeamMember {
  id: string
  name: string
  role: string
  bio: string | null
  image: string | null
  email: string | null
  order: number
  isActive: boolean
  userId: string | null
}

export interface LinkableAccount {
  id: string
  name: string | null
  email: string
  role: string
}

interface TeamManagementProps {
  initialMembers: TeamMember[]
  accounts: LinkableAccount[]
}

const emptyMember = {
  name: '',
  role: '',
  bio: '',
  image: '',
  email: '',
  order: 0,
  isActive: true,
  userId: '',
}

export function TeamManagement({ initialMembers, accounts }: TeamManagementProps) {
  const router = useRouter()
  const [members, setMembers] = useState(initialMembers)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyMember)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const takenAccountIds = new Set(
    members.filter((m) => m.userId && m.id !== editId).map((m) => m.userId as string),
  )

  const startEdit = (member: TeamMember) => {
    setEditId(member.id)
    setForm({
      name: member.name,
      role: member.role,
      bio: member.bio ?? '',
      image: member.image ?? '',
      email: member.email ?? '',
      order: member.order,
      isActive: member.isActive,
      userId: member.userId ?? '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    setLoading(true)
    setError(null)
    try {
      if (editId) {
        await apiRequest(`/api/team/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        await apiRequest('/api/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      setShowForm(false)
      setEditId(null)
      setForm(emptyMember)
      router.refresh()
    } catch (reason) {
      setError(asApiError(reason).message)
    } finally {
      setLoading(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    const data = new FormData()
    data.append('file', file)
    data.append('bucket', 'team-photos')
    try {
      const { url } = await apiRequest<{ url?: string }>('/api/upload', { method: 'POST', body: data })
      if (!url) {
        setError('The upload completed without returning an image URL.')
        return
      }
      setForm((f) => ({ ...f, image: url }))
    } catch (reason) {
      setError(asApiError(reason).message)
    } finally {
      setUploading(false)
      e.currentTarget.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this team member?')) return
    setLoading(true)
    setError(null)
    try {
      await apiRequest(`/api/team/${id}`, { method: 'DELETE' })
      setMembers((m) => m.filter((x) => x.id !== id))
      router.refresh()
    } catch (reason) {
      setError(asApiError(reason).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mb-6">
        <button
          onClick={() => {
            setShowForm(!showForm)
            setEditId(null)
            setForm(emptyMember)
          }}
          className="inline-flex items-center gap-2 bg-navy text-gold px-4 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors"
        >
          {showForm ? <X size={16} /> : <PlusCircle size={16} />}
          {showForm ? 'Cancel' : 'Add Team Member'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-gold/20 p-6 mb-6">
          <h3 className="text-navy font-bold text-base mb-4">
            {editId ? 'Edit Member' : 'New Team Member'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
                Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
            </div>
            <div>
              <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
                Role
              </label>
              <input
                type="text"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Optional - leave blank for no title"
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="tm-account"
                className="block text-navy text-xs font-bold uppercase tracking-widest mb-1"
              >
                Linked account
              </label>
              <select
                id="tm-account"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              >
                <option value="">Not linked (legacy card)</option>
                {accounts
                  .filter((a) => !takenAccountIds.has(a.id) || a.id === form.userId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? '(no name)'}, {a.email} ({a.role})
                    </option>
                  ))}
              </select>
              <p className="text-navy/50 text-xs mt-1">
                Link a card to its owner&apos;s Writer, Editor or Growth account so they edit it from their portal
                instead of creating a second one. The account&apos;s role alone decides the team (Writing, Editorial,
                Growth &amp; Communications); the title and order above only affect how the card is shown within
                that team.
              </p>
            </div>
            <div>
              <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
            </div>
            <div>
              <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
                Photo
              </label>
              <div className="flex items-center gap-3">
                {form.image && (
                  <Image
                    src={form.image}
                    alt="Preview"
                    width={48}
                    height={48}
                    className="rounded-full object-cover ring-2 ring-gold/20 shrink-0"
                  />
                )}
                <div className="flex-1 flex gap-2">
                  <input
                    type="url"
                    value={form.image}
                    onChange={(e) => setForm({ ...form, image: e.target.value })}
                    placeholder="Paste URL or upload"
                    className="flex-1 border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="shrink-0 inline-flex items-center gap-1.5 border border-navy/20 px-3 py-2 text-xs text-navy hover:bg-cream-dark transition-colors disabled:opacity-50"
                  >
                    <Upload size={13} />
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
                Display Order
              </label>
              <input
                type="number"
                value={form.order}
                onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <label className="flex items-center gap-2 text-sm text-navy cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="accent-gold"
                />
                Active
              </label>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-navy text-xs font-bold uppercase tracking-widest mb-1">
              Bio
            </label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              rows={3}
              className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream resize-none"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={loading || !form.name}
            className="inline-flex items-center gap-2 bg-navy text-gold px-5 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-colors disabled:opacity-50"
          >
            <Check size={14} />
            {loading ? 'Saving...' : 'Save Member'}
          </button>
        </div>
      )}

      {/* Members list */}
      <div className="bg-white border border-gold/15 overflow-hidden">
        {members.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gold/15 bg-cream/50">
                <th className="text-left px-6 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden sm:table-cell">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-navy/50 text-xs font-bold uppercase tracking-widest hidden md:table-cell">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-cream/30">
                  <td className="px-6 py-3">
                    <p className="text-navy font-medium">{member.name}</p>
                  </td>
                  <td className="px-4 py-3 text-navy/60 hidden sm:table-cell">
                    {member.role?.trim() ? (
                      member.role
                    ) : (
                      <span className="italic text-navy/35">No title</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-sm ${
                        member.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => startEdit(member)}
                        aria-label={`Edit ${member.name}`}
                        className="text-navy/60 hover:text-navy p-1 transition-colors"
                      >
                        <Edit size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(member.id)}
                        aria-label={`Delete ${member.name}`}
                        className="text-red-400 hover:text-red-600 p-1 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center text-navy/30 text-sm">
            No team members yet.
          </div>
        )}
      </div>
    </div>
  )
}
