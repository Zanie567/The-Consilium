/** Local recovery is an explicit choice, partitioned by authenticated user and article.
 * Each tab owns a record so concurrent tabs cannot erase one another's local work. */
export interface LocalDraft {
  userId: string
  articleId: string
  tabId: string
  at: number
  baseVersion?: string
  fields: {
    title: string; slug: string; content: string; excerpt: string; coverImage: string
    categoryId: string; tags: string[]; authorId: string
  }
}
export const RECOVERY_PREFIX = 'consilium:draft:v1:'
export const RECOVERY_MAX_AGE = 30 * 24 * 60 * 60 * 1000
export function recoveryKey(draft: Pick<LocalDraft, 'userId' | 'articleId' | 'tabId'>): string {
  return RECOVERY_PREFIX + [draft.userId, draft.articleId, draft.tabId].map(encodeURIComponent).join(':')
}
export function readDrafts(storage: Storage, userId: string, articleId: string, now = Date.now()): LocalDraft[] {
  const drafts: LocalDraft[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith(RECOVERY_PREFIX)) continue
    try {
      const d = JSON.parse(storage.getItem(key) ?? '') as LocalDraft
      if (d.userId !== userId || d.articleId !== articleId || recoveryKey(d) !== key) continue
      if (!Number.isFinite(d.at) || d.at > now || now - d.at > RECOVERY_MAX_AGE) continue
      if (!d.fields || !['title','slug','content','excerpt','coverImage','categoryId','authorId'].every(k => typeof d.fields[k as keyof LocalDraft['fields']] === 'string')) continue
      if (!Array.isArray(d.fields.tags) || !d.fields.tags.every(t => typeof t === 'string')) continue
      drafts.push(d)
    } catch { /* Corrupt local records are never applied. */ }
  }
  return drafts.sort((a,b) => b.at - a.at)
}
export function storeDraft(storage: Storage, draft: LocalDraft): void {
  storage.setItem(recoveryKey(draft), JSON.stringify(draft))
}
export function deleteDraft(storage: Storage, draft: LocalDraft): void {
  storage.removeItem(recoveryKey(draft))
}
