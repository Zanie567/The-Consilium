import type { Prisma } from '@prisma/client'
import type { NormalizedTag } from '@/lib/articleTags'

/** Indexed canonical identity, serialised per topic; preserve existing IDs/URLs. */
export async function resolveArticleTag(tx: Prisma.TransactionClient, topic: NormalizedTag): Promise<{ id: string }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${topic.slug}))`
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM tags WHERE public.consilium_tag_identity(name) = ${topic.slug}
    ORDER BY "createdAt", id LIMIT 1`
  if (existing[0]) return existing[0]
  return tx.tag.upsert({ where: { slug: topic.slug }, update: {}, create: topic })
}
