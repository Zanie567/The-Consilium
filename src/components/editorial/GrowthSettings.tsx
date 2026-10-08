'use client'
import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
export function GrowthSettings() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    apiRequest<{ linkedinUrl: string | null }>('/api/editorial/growth/settings')
      .then((data) => setUrl(data.linkedinUrl ?? ''))
      .catch(() => setStatus('Unable to load settings. Reload to retry.'))
      .finally(() => setLoading(false))
  }, [])
  return (
    <form
      aria-busy={loading}
      className="border border-[var(--border)] p-5 mb-6 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (loading) return
        setLoading(true)
        try {
          await apiRequest('/api/editorial/growth/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ linkedinUrl: url.trim() || null }),
          })
          setStatus('Publication links saved.')
        } catch {
          setStatus(
            'Unable to save. Use an https LinkedIn company or school page URL, then try again.'
          )
        } finally {
          setLoading(false)
        }
      }}
    >
      <label className="block text-sm">
        Publication LinkedIn URL
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.linkedin.com/company/…"
          maxLength={500}
          className="block w-full border border-[var(--border)] bg-[var(--bg)] p-2 mt-2"
        />
      </label>
      <p className="text-xs">Leave empty to hide the publication LinkedIn link.</p>
      <button type="submit" disabled={loading} className="border border-[var(--border)] p-2">
        {loading ? 'Loading…' : 'Save publication links'}
      </button>
      <p role="status" className="text-sm">
        {status}
      </p>
    </form>
  )
}
