import { apiRequest, ApiError } from '@/lib/apiClient'
export const MAX_ARTICLE_IMAGE_BYTES = 4 * 1024 * 1024
const pendingUploads = new Set<string>()
const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
export async function uploadArticleImage(
  file: File,
  signal?: AbortSignal
): Promise<{ url: string; width?: number; height?: number }> {
  if (!file.size || file.size > MAX_ARTICLE_IMAGE_BYTES)
    throw new ApiError('validation', 'Choose an image smaller than 4 MB.')
  if (file.type && !TYPES.includes(file.type))
    throw new ApiError('validation', 'Choose a JPEG, PNG, GIF, WebP or AVIF image.')
  const form = new FormData()
  form.append('file', file)
  form.append('bucket', 'article-images')
  const data = await apiRequest<{ url: string; width?: number; height?: number }>('/api/upload', {
    method: 'POST',
    body: form,
    signal,
  })
  if (!data.url)
    throw new ApiError('server', 'The upload did not return an image. Please try again.')
  pendingUploads.add(data.url)
  return data
}
/** Server refuses to delete any object still referenced, including draft/trash. */
export async function discardArticleImage(url: string): Promise<void> {
  try {
    await fetch('/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch {
    /* Best effort; persisted article cleanup retries after save. */
  }
}

/** Discard unattached uploads on normal editor exit; stored/shared refs survive. */
export function discardPendingArticleImages(): void {
  const urls = [...pendingUploads].slice(0, 20)
  if (!urls.length) return
  const body = JSON.stringify({ urls })
  try {
    if (
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon('/api/upload/discard', new Blob([body], { type: 'application/json' }))
    ) {
      urls.forEach((url) => pendingUploads.delete(url))
      return
    }
  } catch {
    /* Fall back for browsers without beacon support. */
  }
  void fetch('/api/upload/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then((res) => {
      if (res.ok) urls.forEach((url) => pendingUploads.delete(url))
    })
    .catch(() => {})
}
