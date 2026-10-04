'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  readDrafts,
  storeDraft,
  deleteDraft,
  recoveryKey,
  RECOVERY_MAX_AGE,
  type LocalDraft,
} from '@/lib/draftRecovery'
export function DraftRecoveryList({ userId }: { userId: string }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<LocalDraft[]>([])
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(0)
  useEffect(() => {
    try {
      setLoadedAt(Date.now())
      setDrafts(readDrafts(localStorage, userId, undefined, Date.now(), true))
    } catch {
      setError('Local storage is unavailable.')
    }
  }, [userId])
  const download = (draft: LocalDraft) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft.fields, null, 2)], { type: 'application/json' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'consilium-unsaved-draft.json'
    link.click()
    URL.revokeObjectURL(url)
  }
  const recreate = (draft: LocalDraft) => {
    if (Date.now() - draft.at > RECOVERY_MAX_AGE) {
      setError('This copy has expired. Download it to keep the content.')
      return
    }
    try {
      storeDraft(localStorage, {
        ...draft,
        articleId: 'new',
        tabId: crypto.randomUUID(),
        at: Date.now(),
        baseVersion: undefined,
        fields: { ...draft.fields, authorId: userId },
      })
      router.push('/editorial/articles/new')
    } catch {
      setError('Could not prepare a local copy. Download the content to keep it.')
    }
  }
  const discard = (draft: LocalDraft) => {
    if (
      !window.confirm(
        'Permanently discard this local recovery copy? This does not delete the server article.'
      )
    )
      return
    try {
      deleteDraft(localStorage, draft)
      setDrafts((d) => d.filter((x) => recoveryKey(x) !== recoveryKey(draft)))
    } catch {
      setError('Could not discard this local copy.')
    }
  }
  return (
    <section className="p-6 max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">Local draft recovery</h1>
      <p>
        These unsaved copies belong to your account on this device. They are not server-saved and
        never submit or publish automatically. Copies older than 30 days can be downloaded or
        discarded, but cannot be restored.
      </p>
      {error && <p role="alert">{error}</p>}
      {drafts.length === 0 && <p>No local recovery copies for your account.</p>}
      {drafts.map((d) => {
        const expired = loadedAt - d.at > RECOVERY_MAX_AGE
        return (
          <article key={recoveryKey(d)} className="border p-4 space-y-3">
            <h2 className="text-lg font-bold">{d.fields.title || 'Untitled draft'}</h2>
            <p>
              {new Date(d.at).toLocaleString()}
              {expired ? ' — expired' : ''}
            </p>
            <p>
              If the original article is deleted, missing or locked, download this copy or
              deliberately recover it as a new draft. Nothing replaces server content without saving
              and resolving any conflict.
            </p>
            <div className="flex gap-4 flex-wrap">
              {!expired && d.articleId !== 'new' && (
                <Link href={`/editorial/articles/${encodeURIComponent(d.articleId)}/edit`}>
                  Open original article
                </Link>
              )}
              {!expired && <button onClick={() => recreate(d)}>Recover as new draft</button>}
              <button onClick={() => download(d)}>Download local copy</button>
              <button onClick={() => discard(d)}>Discard local copy</button>
            </div>
          </article>
        )
      })}
    </section>
  )
}
