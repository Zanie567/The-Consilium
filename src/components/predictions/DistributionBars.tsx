interface Props {
  values: number[]
  unitLabel: string
  /** The resolved actual value, marked on its bucket when present. */
  actualValue?: number | null
}

interface Bucket {
  from: number
  to: number
  count: number
  hasActual: boolean
}

function buildBuckets(values: number[], actualValue: number | null): Bucket[] {
  // Linear scan rather than Math.min(...values): spreading a very large array
  // into arguments can blow the call stack.
  let min = values[0]
  let max = values[0]
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === max) {
    return [
      {
        from: min,
        to: max,
        count: values.length,
        hasActual: actualValue !== null && actualValue === min,
      },
    ]
  }
  const bucketCount = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(values.length))))
  const width = (max - min) / bucketCount
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
    hasActual: false,
  }))
  for (const v of values) {
    const idx = Math.min(bucketCount - 1, Math.floor((v - min) / width))
    buckets[idx].count += 1
  }
  if (actualValue !== null && actualValue >= min && actualValue <= max) {
    const idx = Math.min(bucketCount - 1, Math.floor((actualValue - min) / width))
    buckets[idx].hasActual = true
  }
  return buckets
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/**
 * Server-rendered histogram of submitted predictions. Only ever rendered after
 * the deadline so early submitters cannot anchor everyone else.
 */
export function DistributionBars({ values, unitLabel, actualValue = null }: Props) {
  if (values.length === 0) {
    return <p className="text-sm text-[var(--fg-faint)]">No predictions were submitted.</p>
  }
  const buckets = buildBuckets(values, actualValue)
  const maxCount = Math.max(...buckets.map((b) => b.count))

  return (
    <div className="space-y-1.5">
      {buckets.map((b, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 text-right text-[var(--fg-faint)] tabular-nums">
            {fmt(b.from)} to {fmt(b.to)}
          </span>
          <div className="flex-1 h-5 rounded-sm bg-[var(--bg-subtle)] overflow-hidden">
            <div
              className={b.hasActual ? 'h-full bg-gold' : 'h-full bg-gold/40'}
              style={{ width: `${maxCount === 0 ? 0 : (b.count / maxCount) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-[var(--fg-muted)] tabular-nums">{b.count}</span>
        </div>
      ))}
      <p className="text-[11px] text-[var(--fg-faint)] pt-1">
        Counts of predictions per range, in {unitLabel}.
        {actualValue !== null ? ' The solid bar contains the actual value.' : ''}
      </p>
    </div>
  )
}
