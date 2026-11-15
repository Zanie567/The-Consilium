/**
 * Groups a page of archive articles by the month they were published, for the archive's month
 * headings. Pure, so it is unit-tested without Prisma or the server-component tree.
 *
 * Months are read in the publication's own time zone: an article published at 00:30 on
 * 1 August in Edinburgh belongs to August, even though the server (UTC) still calls that
 * moment 31 July during British Summer Time.
 */

/** The publication's time zone (the same zone editorial scheduling uses). */
const EDITORIAL_TIME_ZONE = 'Europe/London'

export interface ArchiveMonthGroup<T> {
  /** `2026-11`, or `undated` for published articles with no publication date. */
  key: string
  /** "November", or "Undated". */
  month: string
  /** "2026"; empty for the undated group. */
  year: string
  articles: T[]
}

const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: EDITORIAL_TIME_ZONE, month: 'long' })
const yearMonth = new Intl.DateTimeFormat('en-CA', { timeZone: EDITORIAL_TIME_ZONE, year: 'numeric', month: '2-digit' })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { timeZone: EDITORIAL_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "12 Nov 2026" in editorial time; empty when there is no usable date. */
export function formatArchiveDate(value: Date | string | null | undefined): string {
  const date = toDate(value)
  return date ? dayMonthYear.format(date) : ''
}

/** ISO timestamp for a <time datetime>. */
export function archiveDateTimeAttr(value: Date | string | null | undefined): string | undefined {
  return toDate(value)?.toISOString()
}

/**
 * Consecutive articles of the same month become one group. The input order is kept exactly
 * (the query already sorts newest first, undated last), so a group is never reordered and an
 * article never moves between pages because of grouping.
 */
export function groupByMonth<T extends { publishedAt: Date | string | null }>(articles: readonly T[]): ArchiveMonthGroup<T>[] {
  const groups: ArchiveMonthGroup<T>[] = []
  for (const article of articles) {
    const date = toDate(article.publishedAt)
    const key = date ? yearMonth.format(date) : 'undated'
    const last = groups[groups.length - 1]
    if (last?.key === key) {
      last.articles.push(article)
      continue
    }
    groups.push({
      key,
      month: date ? monthName.format(date) : 'Undated',
      year: date ? key.slice(0, 4) : '',
      articles: [article],
    })
  }
  return groups
}
