'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useCallback } from 'react'

const BOOKMARKS_KEY = '/api/bookmarks'

async function fetcher(url: string): Promise<string[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/**
 * Shared bookmark state for the signed-in user.
 *
 * Every <BookmarkButton> on a page calls this hook with the SAME SWR key
 * ('/api/bookmarks'). SWR collapses all of those into a SINGLE in-flight
 * request and serves the rest from its shared cache — previously each card
 * fetched the full list independently, so a 18-card grid fired GET
 * /api/bookmarks 18+ times per page (a primary source of DB connection
 * pressure behind the comment 503s). Toggling updates the shared cache in
 * place so every button on the page stays in sync without a refetch.
 */
export function useBookmarks() {
  const { data: session } = useSession()
  // Null key → SWR makes no request at all for signed-out visitors.
  const key = session ? BOOKMARKS_KEY : null

  const { data, mutate } = useSWR<string[]>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  const ids = data ?? []
  // "Loaded" for a signed-out user is immediately true (nothing to fetch).
  const isLoaded = !session || data !== undefined

  const toggle = useCallback(
    async (articleId: string): Promise<boolean | null> => {
      try {
        const res = await fetch(BOOKMARKS_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId }),
        })
        if (!res.ok) return null
        const { bookmarked } = (await res.json()) as { bookmarked: boolean }
        await mutate(
          (current = []) =>
            bookmarked
              ? Array.from(new Set([...current, articleId]))
              : current.filter((id) => id !== articleId),
          { revalidate: false },
        )
        return bookmarked
      } catch (err) {
        // Network/parse failure (offline, DNS, malformed body) — log it and
        // leave the shared cache unchanged; the caller gets null, not a throw.
        console.error('Bookmark toggle failed:', err)
        return null
      }
    },
    [mutate],
  )

  return { ids, isLoaded, toggle }
}
