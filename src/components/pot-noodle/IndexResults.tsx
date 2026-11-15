import { formatValue, latestChange, type PublishedResults } from '@/lib/potNoodleIndex'

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`))

/** Before publication: what the index will report, as a till receipt with nothing printed yet. */
export function AwaitingResults() {
  const rows = [
    ['Latest index value', 'Awaiting data'],
    ['Change since the last update', 'Awaiting data'],
    ['Cities and universities compared', 'Where the data allow'],
    ['Responses used', 'Published with the results'],
    ['Data collected', 'Collection in progress'],
  ]
  return (
    <div className="pni-receipt" role="group" aria-label="Index results: not yet published">
      <p className="pni-receipt-head">The Pot Noodle Index</p>
      <p className="pni-receipt-sub">No figures yet</p>
      <dl className="pni-receipt-rows">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="pni-receipt-foot">First results will be printed here</p>
    </div>
  )
}

/** A small line of the index over time, drawn from the published series only. */
function Trend({ results }: { results: PublishedResults }) {
  const { series } = results
  if (series.length < 2) return null
  const values = series.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = series.map((p, i) => `${(i / (series.length - 1)) * 300},${90 - ((p.value - min) / span) * 80}`).join(' ')
  return (
    <svg viewBox="0 0 300 100" className="mt-6 h-28 w-full" role="img" aria-label={`Index from ${formatValue(series[0].value, results)} to ${formatValue(series.at(-1)!.value, results)} ${results.unit}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="text-gold-dark dark:text-gold" />
    </svg>
  )
}

/** After publication: the verified figures, with their dates and method beside them. */
export function PublishedIndex({ results }: { results: PublishedResults }) {
  const latest = results.series.at(-1)!
  const change = latestChange(results.series)
  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <p className="text-sm text-[var(--fg-muted)]">Latest index value</p>
        <p className="mt-1 text-6xl font-bold tabular-nums text-[var(--fg)]" style={{ fontFamily: 'var(--font-serif)' }}>{formatValue(latest.value, results)}</p>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{results.unit}</p>
        {change !== null && (
          <p className="mt-2 text-sm text-[var(--fg-muted)]">
            {change === 0 ? 'Unchanged' : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}%`} since the previous update
          </p>
        )}
        <Trend results={results} />
        <p className="mt-4 text-xs text-[var(--fg-muted)]">
          {results.responses.toLocaleString('en-GB')} responses collected {longDate(results.collectedFrom)} to {longDate(results.collectedTo)}. Updated {longDate(results.updatedAt)}.
        </p>
      </div>
      {results.places.length > 0 && (
        <div className="lg:col-span-7">
          <table className="w-full text-sm">
            <caption className="mb-2 text-left text-sm text-[var(--fg-muted)]">By place (at least {results.minimumPlaceResponses} responses each)</caption>
            <thead>
              <tr className="border-b border-[var(--border-strong)] text-left text-xs uppercase tracking-wider text-[var(--fg-muted)]">
                <th scope="col" className="py-2">Place</th>
                <th scope="col" className="py-2 text-right">Index ({results.unit})</th>
                <th scope="col" className="py-2 text-right">Responses</th>
              </tr>
            </thead>
            <tbody>
              {results.places.map((r) => (
                <tr key={r.name} className="border-b border-[var(--border)]">
                  <th scope="row" className="py-2 text-left font-medium text-[var(--fg)]">{r.name}</th>
                  <td className="py-2 text-right tabular-nums">{formatValue(r.value, results)}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--fg-muted)]">{r.responses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
