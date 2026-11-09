import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
export const LINKEDIN_SETTING_KEY = 'publication_linkedin_url'
export const GROWTH_SETTINGS_TAG = 'publication-growth-settings'
export function validLinkedInUrl(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 500)
    throw new Error('Enter a valid LinkedIn publication URL.')
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      !/^\/(company|school)\/[^/]+\/?$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new Error()
    return url.href
  } catch {
    throw new Error('Enter the https LinkedIn company or school page URL.')
  }
}
/**
 * Seconds before the cached LinkedIn URL is re-read on a timer. The footer renders this on every
 * page, and a route revalidates as often as the shortest cache inside it, so this value sets how
 * often EVERY otherwise-static page (/about, /privacy, /terms, ...) is rebuilt, and caps how long a
 * CDN-cached (ISR) page can stay cached. Saving the setting already expires GROWTH_SETTINGS_TAG at
 * once, and that tag is attached to every page that shows the link, so the timer is only a fallback
 * in case that expiry fails. At 60 s each visited page was rebuilt about once a minute; at 1 h the
 * static pages were still about 4% of the project's Vercel CPU (November 2026), hence one day.
 */
export const PUBLICATION_LINKEDIN_REVALIDATE_SECONDS = 86_400

// Throws on a database error, so the failure is never stored in the cache as "no link" for a day.
const readPublicationLinkedIn = unstable_cache(
  async () => validLinkedInUrlOrNull(
    (
      await prisma.siteSetting.findUnique({
        where: { key: LINKEDIN_SETTING_KEY },
        select: { value: true },
      })
    )?.value ?? null
  ),
  ['publication-linkedin'],
  { tags: [GROWTH_SETTINGS_TAG], revalidate: PUBLICATION_LINKEDIN_REVALIDATE_SECONDS }
)

function validLinkedInUrlOrNull(value: string | null) {
  try {
    return validLinkedInUrl(value)
  } catch {
    return null
  }
}

/** The publication's LinkedIn URL, or null when unset, invalid, or the database is unavailable. */
export function getPublicationLinkedIn(): Promise<string | null> {
  return readPublicationLinkedIn().catch(() => null)
}
