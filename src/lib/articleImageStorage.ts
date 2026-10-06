/** Article-image cleanup only recognises new owned keys. Legacy URLs stay intact. */
import { createClient } from '@supabase/supabase-js'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { escapeLikePattern } from '@/lib/searchText'

export class ArticleImageUnavailableError extends Error {}

export function articleImagePath(url: unknown, userId?: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  if (!base || typeof url !== 'string') return undefined
  const prefix = `${base}/storage/v1/object/public/article-images/`
  if (!url.startsWith(prefix)) return undefined
  const path = url.slice(prefix.length)
  if (!/^[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(png|jpg|gif|webp|avif)$/.test(path)) return undefined
  if (userId && path.split('/')[0] !== userId) return undefined
  return path
}
export function articleImageReferences(content: unknown, coverImage: unknown): string[] {
  const refs = new Set<string>()
  if (articleImagePath(coverImage) && typeof coverImage === 'string') refs.add(coverImage)
  if (typeof content !== 'string') return [...refs]
  try {
    const walk = (node: unknown, depth: number) => {
      if (depth > 100 || !node || typeof node !== 'object') return
      const n = node as { attrs?: { src?: unknown }; content?: unknown[] }
      if (articleImagePath(n.attrs?.src) && typeof n.attrs?.src === 'string') refs.add(n.attrs.src)
      if (Array.isArray(n.content)) n.content.forEach((child) => walk(child, depth + 1))
    }
    walk(JSON.parse(content), 0)
  } catch {
    /* Legacy plain content isn't a managed-image document. */
  }
  return [...refs].sort()
}
/** Every article mutation takes these locks before storing a managed reference. */
export async function lockArticleImages(
  tx: Prisma.TransactionClient,
  content: unknown,
  coverImage: unknown
): Promise<void> {
  for (const url of articleImageReferences(content, coverImage)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${url}`}))`
    const asset = await tx.articleImageAsset.findUnique({ where: { url }, select: { url: true } })
    if (!asset)
      throw new ArticleImageUnavailableError(
        'This uploaded image is no longer available. Upload it again before saving.'
      )
    await tx.articleImageAsset.updateMany({ where: { url }, data: { unusedSince: null } })
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
  if (!path) return 'unmanaged'
  if (!base || !key) return 'failed'
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${url}`}))`
        const references = await tx.article.count({
          where: { OR: [{ coverImage: url }, { content: { contains: escapeLikePattern(url) } }] },
        })
        if (references) return 'retained'
        const { error } = await createClient(base, key)
          .storage.from('article-images')
          .remove([path])
        if (error) return 'failed'
        await tx.articleImageAsset.deleteMany({ where: { url } })
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
  if (!articleImagePath(url, userId)) return
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`image:${url}`}))`
      const count = await tx.article.count({
        where: { OR: [{ coverImage: url }, { content: { contains: escapeLikePattern(url) } }] },
      })
      await tx.articleImageAsset.updateMany({
        where: { url, unusedSince: null },
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
      if (permanent) await removeUnreferencedArticleImage(url)
      else await queueArticleImageCleanup(url)
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
