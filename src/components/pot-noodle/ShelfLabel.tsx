import { formatValue, type PublishedResults } from '@/lib/potNoodleIndex'

/**
 * The hero's shelf-edge price label: the index's one bold graphic. Until results are published it
 * shows an empty price ("£ –.––"), never a made-up figure. It swings in once on load (CSS only; still
 * under prefers-reduced-motion) and hangs from a ruled shelf edge.
 */
export function ShelfLabel({ results }: { results: PublishedResults | null }) {
  const latest = results?.series.at(-1)
  return (
    <figure className="pni-label-wrap" aria-label={latest ? `Latest index value: ${formatValue(latest.value, results!)} ${results!.unit}` : 'Index value: awaiting enough responses'}>
      <div className="pni-shelf" aria-hidden />
      <div className="pni-label" aria-hidden>
        <div className="pni-label-top">
          <span>Pot Noodle Index</span>
          <span>Student cost of living</span>
        </div>
        <p className="pni-price">
          {latest ? (
            <span>{formatValue(latest.value, results!)}</span>
          ) : (
            // Unprinted digit slots: clearly no price, never a made-up one.
            <span className="pni-price-empty">
              <span className="pni-slot" />
              <span className="pni-slot" />
              <span className="pni-slot" />
              <span className="pni-slot-dot">.</span>
              <span className="pni-slot" />
            </span>
          )}
        </p>
        <div className="pni-label-bottom">
          <span className="pni-barcode" />
          <span className="pni-label-note">{latest ? `Updated ${results!.updatedAt}` : 'Awaiting enough responses'}</span>
        </div>
      </div>
    </figure>
  )
}
