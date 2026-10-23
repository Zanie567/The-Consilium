import { describe, expect, it } from 'vitest'
import { coverMetadataKey, parseCoverMetadata, validateCoverMetadata } from '@/lib/coverImageMetadata'

const value = {
  imageUrl: 'https://cdn.example.org/cover.jpg',
  caption: 'Solar farm and coal-fired power station in India.',
  source: 'Original photographer / agency',
  sourceUrl: 'https://example.org/original',
}

describe('article cover image attribution', () => {
  it('ties attribution to the exact cover, avoiding stale credits after image replacement', () => {
    expect(parseCoverMetadata(JSON.stringify(value), value.imageUrl)).toEqual(value)
    expect(parseCoverMetadata(JSON.stringify(value), 'https://cdn.example.org/replacement.jpg')).toBeNull()
  })
  it('refuses unsafe URLs and arbitrarily long captions', () => {
    expect(validateCoverMetadata({ ...value, sourceUrl: 'javascript:alert(1)' })).toBeNull()
    expect(validateCoverMetadata({ ...value, sourceUrl: 'data:text/html,evil' })).toBeNull()
    expect(validateCoverMetadata({ ...value, caption: 'x'.repeat(501) })).toBeNull()
  })
  it('never trusts malformed stored JSON', () => {
    expect(parseCoverMetadata('not json', value.imageUrl)).toBeNull()
    expect(parseCoverMetadata(JSON.stringify({ ...value, source: null }), value.imageUrl)).toBeNull()
    expect(parseCoverMetadata(JSON.stringify(value), null)).toBeNull()
  })
  it('uses per-article keys so attribution for one cover cannot overwrite another', () => {
    expect(coverMetadataKey('one')).not.toBe(coverMetadataKey('two'))
  })
})
