/**
 * The Pot Noodle Index: the single source of truth for what /pot-noodle-index states.
 *
 * Maintainers: every value here is public.
 *   - the submission form ...... `form.responderUrl`: the Google Forms responder link
 *                                 (https://docs.google.com/forms/d/e/<id>/viewform). null = not ready yet;
 *                                 the page then says the form is coming instead of linking anywhere.
 *   - results .................. leave `results.published` false until the methodology, data source and
 *                                 validation rules are agreed and the figures have been checked. The page
 *                                 shows nothing numeric until `publishableResults` accepts the data.
 *
 * There is deliberately no automated results pipeline: figures are entered here by hand, after review.
 */

export type PotNoodleStatus = 'collecting' | 'analysing' | 'published'

/** One published observation of the index. */
export interface IndexPoint {
  /** YYYY-MM-DD: the end of the collection period this value describes. */
  date: string
  value: number
}

/** A city, university or country, with enough responses to be shown. */
export interface PlaceResult {
  name: string
  value: number
  /** Responses behind this figure; places below the agreed minimum are not shown. */
  responses: number
}

/**
 * The published index. Deliberately unit-neutral: what the index measures (a basket of everyday student
 * costs, an index number, a single price) and how currencies are made comparable is decided with the
 * methodology, not assumed here. `unit` says how a value reads ("index points", "£ per week").
 */
export interface PublishedResults {
  published: true
  /** How a value reads, e.g. "index points" or "£ per week". */
  unit: string
  /** Decimal places to show. */
  decimals: number
  /** When the figures were last updated (ISO date). */
  updatedAt: string
  /** First and last day of data collection (ISO dates). */
  collectedFrom: string
  collectedTo: string
  /** Valid responses after cleaning. */
  responses: number
  /** Agreed minimum responses for a place to be shown. */
  minimumPlaceResponses: number
  /** Index values over time, oldest first; the last one is the latest value. */
  series: IndexPoint[]
  places: PlaceResult[]
  /** Plain-language methodology, published with the first results. */
  methodology: string[]
}

export type PotNoodleResults = { published: false } | PublishedResults

export const POT_NOODLE_INDEX = {
  name: 'The Pot Noodle Index',
  status: 'collecting' as PotNoodleStatus,
  form: {
    /**
     * Supplied by the editors on 15 November 2026 as https://forms.gle/BtUh9CnvYPGLFD9E7; stored as the
     * full responder link it resolves to, because only that form can be embedded. Never guess this value.
     */
    responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSeS11HO0EzhS-MkarU7FJHeRxfiC6_2gLDahBYkUBM9wHmSAA/viewform' as string | null,
  },
  results: { published: false } as PotNoodleResults,
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

/**
 * The results the page may show, or null. Anything incomplete or inconsistent is withheld rather than
 * partly shown: a published index with a missing methodology, an empty series, a negative price or a
 * place below its own minimum would read as fact.
 */
export function publishableResults(results: PotNoodleResults = POT_NOODLE_INDEX.results): PublishedResults | null {
  if (!results.published) return null
  const r = results
  if (![r.updatedAt, r.collectedFrom, r.collectedTo].every(validDate) || r.collectedFrom > r.collectedTo) return null
  if (!Number.isInteger(r.responses) || r.responses <= 0) return null
  if (!r.unit.trim() || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 3) return null
  if (!Number.isInteger(r.minimumPlaceResponses) || r.minimumPlaceResponses <= 0) return null
  if (r.methodology.filter((line) => line.trim()).length === 0) return null
  if (r.series.length === 0) return null
  for (let i = 0; i < r.series.length; i++) {
    const p = r.series[i]
    if (!validDate(p.date) || !Number.isFinite(p.value) || p.value <= 0) return null
    if (i > 0 && p.date <= r.series[i - 1].date) return null
  }
  if (r.places.some((g) => !g.name.trim() || !Number.isFinite(g.value) || g.value <= 0 || g.responses < r.minimumPlaceResponses)) return null
  return r
}

/** A value with its published precision, e.g. "104.2". */
export function formatValue(value: number, results: Pick<PublishedResults, 'decimals'>): string {
  return value.toLocaleString('en-GB', { minimumFractionDigits: results.decimals, maximumFractionDigits: results.decimals })
}

/** Change from the previous published value, in percent (one decimal), or null with fewer than two. */
export function latestChange(series: readonly IndexPoint[]): number | null {
  if (series.length < 2) return null
  const [prev, last] = series.slice(-2)
  return Math.round(((last.value - prev.value) / prev.value) * 1000) / 10
}
