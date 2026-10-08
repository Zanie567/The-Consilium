/** Article-image cleanup only recognises new owned keys. Legacy URLs stay intact. */
import { createClient } from '@supabase/supabase-js'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export class ArticleImageUnavailableError extends Error {}

export function articleImagePath(url: unknown, userId?: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  if (!base || typeof url !== 'string') return undefined
  try {
    const configured = new URL(base)
    const candidate = new URL(url)
    if (candidate.origin !== configured.origin || candidate.username || candidate.password)
      return undefined
    const prefix = `${configured.pathname.replace(/\/+$/, '')}/storage/v1/object/public/article-images/`
    const pathname = decodeURIComponent(candidate.pathname)
    if (!pathname.startsWith(prefix)) return undefined
    const path = pathname.slice(prefix.length)
    if (!/^[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(png|jpg|gif|webp|avif)$/.test(path)) return undefined
    if (userId && path.split('/')[0] !== userId) return undefined
    return path
  } catch {
    return undefined
  }
}
function canonicalImageUrl(url: unknown, userId?: string): string | undefined {
  const path = articleImagePath(url, userId)
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  return path && base ? `${base}/storage/v1/object/public/article-images/${path}` : undefined
}
/** Decode JSON in PostgreSQL so escaped slashes/Unicode cannot hide a reference.
 * Percent-encoded URL characters and query/hash aliases retain the same object.
 * Match the globally unique object filename conservatively, including foreign
 * URLs with that filename, rather than risk deleting a URL-normalised alias.
 * The raw-text check also protects legacy HTML/plain content. Malformed JSON fails
 * safely: cleanup catches database errors and never removes the object.
 */
async function storedImageReferences(tx: Prisma.TransactionClient, url: string): Promise<number> {
  const filename = articleImagePath(url)!.split('/')[1]
  const pattern = Array.from(filename, (character) => {
    const literal = character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `(${literal}|%${character.charCodeAt(0).toString(16).padStart(2, '0')})`
  }).join('')
  const rows = await tx.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM articles a
    WHERE a."coverImage" ~* ${pattern}
       OR a.content ~* ${pattern}
       OR EXISTS (
         SELECT 1 FROM jsonb_path_query(
           CASE WHEN a.content IS JSON THEN a.content::jsonb ELSE '{}'::jsonb END,
           '$.**.src'
         ) AS source(value)
         WHERE (source.value #>> '{}') ~* ${pattern}
       )`
  return rows[0]?.count ?? 0
}

export function articleImageReferences(content: unknown, coverImage: unknown): string[] {
  const refs = new Set<string>()
  const cover = canonicalImageUrl(coverImage)
  if (cover) refs.add(cover)
  if (typeof content !== 'string') return [...refs]
  try {
    const walk = (node: unknown, depth: number) => {
      if (depth > 100 || !node || typeof node !== 'object') return
      const n = node as { attrs?: { src?: unknown }; content?: unknown[] }
      const source = canonicalImageUrl(n.attrs?.src)
      if (source) refs.add(source)
      if (Array.isArray(n.content)) n.content.forEach((child) => walk(child, depth + 1))
    }
    walk(JSON.parse(content), 0)
  } catch {
    /* Legacy plain content isn't a managed-image document. */
  }
  return [...refs].sort()
}
/** Acquire canonical locks before touching article rows, consistently for
 * saves and deletes, so a delete cannot deadlock against a concurrent save.
 */
export async function lockArticleImageReferences(
  tx: Prisma.TransactionClient,
  content: unknown,
  coverImage: unknown
): Promise<string[]> {
  const urls = articleImageReferences(content, coverImage)
  for (const url of urls)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${url}`}))`
  return urls
}
/** Every article mutation takes these locks before storing a managed reference. */
export async function lockArticleImages(
  tx: Prisma.TransactionClient,
  content: unknown,
  coverImage: unknown
): Promise<void> {
  for (const url of await lockArticleImageReferences(tx, content, coverImage)) {
    const asset = await tx.articleImageAsset.findUnique({ where: { url }, select: { url: true } })
    if (!asset)
      throw new ArticleImageUnavailableError(
        'This uploaded image is no longer available. Upload it again before saving.'
      )
    await tx.articleImageAsset.updateMany({ where: { url }, data: { unusedSince: null } })
  }
}
/** Persist cleanup eligibility in the same transaction that deletes an article.
 * GC rechecks every remaining reference before removal, including shared images.
 */
export async function queueDeletedArticleImages(
  tx: Prisma.TransactionClient,
  content: unknown,
  coverImage: unknown
): Promise<void> {
  for (const url of await lockArticleImageReferences(tx, content, coverImage)) {
    await tx.articleImageAsset.updateMany({
      where: { url, unusedSince: null },
      data: { unusedSince: new Date() },
    })
  }
}
/** Reference check and storage removal share the reference lock with saves. */
export async function removeUnreferencedArticleImage(
  url: string,
  userId?: string
): Promise<'removed' | 'retained' | 'unmanaged' | 'failed'> {
  const path = articleImagePath(url, userId)
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const canonical = canonicalImageUrl(url, userId)
  if (!path || !canonical) return 'unmanaged'
  if (!base || !key) return 'failed'
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${canonical}`}))`
        const references = await storedImageReferences(tx, canonical)
        if (references) return 'retained'
        const { error } = await createClient(base, key)
          .storage.from('article-images')
          .remove([path])
        if (error) return 'failed'
        await tx.articleImageAsset.deleteMany({ where: { url: canonical } })
        return 'removed'
      },
      { timeout: 15000 }
    )
  } catch {
    return 'failed'
  }
}
/** Queue ordinary-edit cleanup so the editor's Undo can still restore old images. */
export async function queueArticleImageCleanup(url: string, userId?: string): Promise<void> {
  const canonical = canonicalImageUrl(url, userId)
  if (!canonical) return
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${canonical}`}))`
      const count = await storedImageReferences(tx, canonical)
      await tx.articleImageAsset.updateMany({
        where: { url: canonical, unusedSince: null },
        data: { unusedSince: count ? null : new Date() },
      })
    })
  } catch {
    console.error('[article-images] unable to queue cleanup')
  }
}
export async function cleanupRemovedArticleImages(
  oldContent: unknown,
  oldCover: unknown,
  nextContent: unknown,
  nextCover: unknown,
  permanent = false
): Promise<void> {
  const current = new Set(articleImageReferences(nextContent, nextCover))
  for (const url of articleImageReferences(oldContent, oldCover))
    if (!current.has(url)) {
      await queueArticleImageCleanup(url)
      if (permanent) await removeUnreferencedArticleImage(url)
    }
}
/** 30-day grace protects Undo/recovery; bounded cron batch, no legacy objects. */
export async function collectUnusedArticleImages(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 86400_000)
  const assets = await prisma.articleImageAsset.findMany({
    where: { unusedSince: { lte: cutoff } },
    orderBy: { unusedSince: 'asc' },
    take: 20,
  })
  let removed = 0
  const deadline = Date.now() + 40_000
  for (const asset of assets) {
    if (Date.now() > deadline) break
    const result = await removeUnreferencedArticleImage(asset.url)
    if (result === 'removed') removed++
    if (result === 'retained')
      await prisma.articleImageAsset.updateMany({
        where: { url: asset.url },
        data: { unusedSince: null },
      })
  }
  return removed
}
