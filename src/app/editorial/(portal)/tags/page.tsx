import type { Metadata } from 'next'
import { requirePortalRole } from '@/lib/portalAccess'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { listManagedTags, listPendingSuggestions } from '@/lib/tags/manage'
import { TagManager } from '@/components/editorial/TagManager'

export const metadata: Metadata = {
  title: 'Tags | Editorial',
  robots: { index: false, follow: false },
}

/**
 * The tag taxonomy: every tag with its aliases and usage, suggestions waiting for review, and
 * likely duplicates. Tag managers only (TAG_MANAGE_ROLES); every action behind it re-checks the
 * role on the server.
 */
export default async function TagsPage() {
  await requirePortalRole(TAG_MANAGE_ROLES)
  const loaded = await Promise.all([listManagedTags(prisma), listPendingSuggestions(prisma)]).catch((error: unknown) => {
    console.error('[editorial/tags] DB error:', error)
    return null
  })
  if (!loaded) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
        <h1 className="mb-4 pl-10 text-2xl font-bold text-[var(--fg)] md:pl-0" style={{ fontFamily: 'var(--font-serif)' }}>Tags</h1>
        <div role="alert" className="border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-600 dark:text-red-400">
          Tags could not be loaded. If this persists, the tag taxonomy migration (20261115120000) may not be applied yet.
        </div>
      </div>
    )
  }
  const [tags, suggestions] = loaded
  return <TagManager tags={tags} suggestions={suggestions} />
}
