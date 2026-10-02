/**
 * Storage for Meet the Team photos (server-side only).
 *
 * Files live in the `avatars` bucket under `<userId>/`, and the path is built here
 * from the verified session user — a client never supplies a path or a URL, so it
 * cannot write into, point at or delete from anyone else's folder. The service-role
 * key stays on the server; the browser never talks to storage directly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'avatars'

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? createClient(url, key) : null
}

export class StorageUnavailableError extends Error {}

/** Uploads a verified image and returns its public URL. */
export async function uploadTeamPhoto(
  userId: string,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<{ url: string; path: string }> {
  const supabase = client()
  if (!supabase) throw new StorageUnavailableError('Image storage is not configured.')

  const path = `${userId}/team-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${EXTENSION[mimeType] ?? 'img'}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`Photo upload failed: ${error.message}`)

  return { url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path }
}

/** The storage path of a URL if (and only if) it is a file in `userId`'s own folder. */
export function ownedPhotoPath(url: string | null | undefined, userId: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '')
  if (!url || !base) return null
  const prefix = `${base}/storage/v1/object/public/${BUCKET}/${userId}/`
  if (!url.startsWith(prefix)) return null
  const name = url.slice(prefix.length)
  if (!name || name.includes('/') || name.includes('..')) return null
  return `${userId}/${name}`
}

/**
 * Best-effort removal of a photo this user owns. Never throws: a leftover file is
 * harmless clutter, whereas failing a save over it would be worse. Legacy
 * `/team/*.png` images and anyone else's files are ignored by `ownedPhotoPath`.
 */
export async function removeTeamPhoto(url: string | null | undefined, userId: string): Promise<void> {
  const path = ownedPhotoPath(url, userId)
  const supabase = client()
  if (!path || !supabase) return
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch (error) {
    console.error('[team-profile] could not remove old photo', error)
  }
}

export async function removeTeamPhotoAtPath(path: string): Promise<void> {
  const supabase = client()
  if (!supabase) return
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch (error) {
    console.error('[team-profile] could not clean up uploaded photo', error)
  }
}
