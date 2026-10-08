import { createHash } from 'node:crypto'

/**
 * A fingerprint of everything an editor can change on an article. The editor sends the
 * one it last saw with every save (`baseVersion`); the server refuses the save when the
 * stored article no longer matches, so a stale browser tab cannot silently overwrite
 * newer work (see PUT /api/articles/[id]).
 *
 * It complements the editorial `updatedAt` guard with an explicit content snapshot.
 * Readership counters are deliberately excluded from this fingerprint.
 */
export interface VersionedArticle {
  title: string
  slug: string
  content: string
  excerpt: string | null
  coverImage: string | null
  categoryId: string | null
  authorId: string
  status: string
  scheduledAt: Date | null
}

export function articleVersion(article: VersionedArticle, tagNames: readonly string[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        article.title,
        article.slug,
        article.content,
        article.excerpt ?? '',
        article.coverImage ?? '',
        article.categoryId ?? '',
        article.authorId,
        article.status,
        article.scheduledAt?.toISOString() ?? '',
        [...tagNames].sort(),
      ]),
    )
    .digest('hex')
    .slice(0, 24)
}
