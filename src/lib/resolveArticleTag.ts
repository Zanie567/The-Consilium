import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type { NormalizedTag } from '@/lib/articleTags'
import { canonicalTagSlug } from '@/lib/tagIdentity'

/** Indexed canonical identity; preserve existing IDs/URLs, including legacy slugs. */
export async function resolveArticleTag(
  tx: Prisma.TransactionClient,
  topic: NormalizedTag
): Promise<{ id: string; name: string }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${topic.slug}))`
  const existing = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM tags WHERE public.consilium_tag_identity(name) = ${topic.slug}
    ORDER BY "createdAt", id LIMIT 1`
  if (existing[0]) return existing[0]
  const suffix = createHash('sha256').update(topic.slug).digest('hex').slice(0, 10)
  // A legacy URL can occupy another topic's canonical slug. Never merge its identity.
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug =
      attempt === 0 ? topic.slug : `${topic.slug}-${suffix}${attempt > 1 ? `-${attempt}` : ''}`
    const tag = await tx.tag.upsert({
      where: { slug },
      update: {},
      create: { ...topic, slug },
      select: { id: true, name: true },
    })
    if (canonicalTagSlug(tag.name) === topic.slug) return tag
  }
  throw new Error('Topic URL conflict. Please choose a more specific topic name.')
}
