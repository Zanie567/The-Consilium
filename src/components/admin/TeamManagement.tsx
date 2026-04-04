'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlusCircle, Trash2, Edit, Check, X } from 'lucide-react'

interface TeamMember {
  id: string
  name: string
  role: string
  bio: string | null
  image: string | null
  email: string | null
  order: number
  isActive: boolean
}

interface TeamManagementProps {
  initialMembers: TeamMember[]
}

const emptyMember = {
  name: '',
  role: '',
  bio: '',
  image: '',
  email: '',
  order: 0,
  isActive: true,
}

export function TeamManagement({ initialMembers }: TeamManagementProps) {
  const router = useRouter()
  const [members, setMembers] = useState(initialMembers)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyMember)
  const [loading, setLoading] = useState(false)

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
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      if (editId) {
        await fetch(`/api/team/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        await fetch('/api/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }
      setShowForm(false)
      setEditId(null)
      setForm(emptyMember)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this team member?')) return
    setLoading(true)
    try {
      await fetch(`/api/team/${id}`, { method: 'DELETE' })
      setMembers((m) => m.filter((x) => x.id !== id))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
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
                Role *
              </label>
              <input
                type="text"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
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
                Image URL
              </label>
              <input
                type="url"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                className="w-full border border-navy/20 px-3 py-2 text-sm focus:outline-none focus:border-gold bg-cream"
              />
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
            disabled={loading || !form.name || !form.role}
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
                    {member.role}
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
                        className="text-navy/60 hover:text-navy p-1 transition-colors"
                      >
                        <Edit size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(member.id)}
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
