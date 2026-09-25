/**
 * Copy and iconography for "this list has nothing in it yet" states across the
 * public site (homepage category tabs, category pages, tag pages, author pages,
 * archive).
 *
 * Every public surface that can legitimately be empty should render
 * `<ArticleEmptyState />` with a state from here, so an empty News section reads
 * the same whether the reader arrived via the homepage tabs or /category/news.
 *
 * IMPORTANT — "coming soon" vs "no results":
 *   These states promise that content is on the way, which is only true when the
 *   list is empty because nothing has been published yet. A list that is empty
 *   because the reader applied a filter or searched is a DIFFERENT state: it must
 *   say nothing matched and offer a way back, never "more coming soon". Use
 *   `noResultsEmptyState` for that case.
 */

export interface SectionEmptyState {
  /** SVG path data, rendered at 24x24 with a 1.5 stroke. */
  icon: string
  title: string
  description: string
}

const ICONS = {
  chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  newspaper: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z',
  pencil: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  archive: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  tag: 'M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 10V5a2 2 0 012-2z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
} as const

/**
 * Per-section copy, keyed by category slug. A section without an entry falls back
 * to generic copy built from its name, so adding a category in /admin does not
 * require a code change here — it only means the copy is generic until someone
 * writes a line for it.
 */
const SECTION_COPY: Record<string, { icon: string; description: string }> = {
  interviews: {
    icon: ICONS.chat,
    description: 'In-depth conversations with economists, policymakers, and thought leaders. Coming soon.',
  },
  analysis: {
    icon: ICONS.chart,
    description: 'Rigorous economic analysis and research. Our writers are working on it.',
  },
  news: {
    icon: ICONS.newspaper,
    description: 'Economic news and commentary. More articles are on the way.',
  },
  opinion: {
    icon: ICONS.pencil,
    description: 'Independent opinion and commentary. Our writers are crafting their arguments.',
  },
}

/**
 * The empty state for a category/section that has published nothing yet.
 *
 * @param slug          category slug, used to look up bespoke copy
 * @param categoryName  display name, used in the heading and generic fallback
 */
export function getSectionEmptyState(slug: string, categoryName: string): SectionEmptyState {
  const copy = SECTION_COPY[slug]
  return {
    icon: copy?.icon ?? ICONS.archive,
    title: `${categoryName} Coming Soon`,
    description:
      copy?.description ??
      `No ${categoryName.toLowerCase()} articles published yet. Check back soon.`,
  }
}

/** The site has published nothing at all yet. */
export const siteEmptyState: SectionEmptyState = {
  icon: ICONS.newspaper,
  title: 'More Coming Soon',
  description: 'Our first articles are on the way. Check back shortly for the latest from The Consilium.',
}

/** A tag page with no published articles. */
export function getTagEmptyState(tagName: string): SectionEmptyState {
  return {
    icon: ICONS.tag,
    title: 'More Coming Soon',
    description: `Nothing has been published under “${tagName}” yet. Check back soon.`,
  }
}

/** An author page with no published articles. */
export function getAuthorEmptyState(filtered: boolean): SectionEmptyState {
  return {
    icon: ICONS.user,
    title: filtered ? 'Nothing in This Section' : 'More Coming Soon',
    description: filtered
      ? 'This writer has not published anything in this section yet. Try another section.'
      : 'This writer has not published anything yet. Check back soon.',
  }
}

/**
 * A search or filter returned nothing. Deliberately does NOT promise more is
 * coming — the reader narrowed the list themselves, and the useful next step is
 * widening it again.
 */
export const noResultsEmptyState: SectionEmptyState = {
  icon: ICONS.search,
  title: 'No Matching Articles',
  description: 'Nothing matches these filters. Try a different search term or clear the filters to see everything.',
}
