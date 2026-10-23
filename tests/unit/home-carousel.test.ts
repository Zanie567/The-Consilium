import { describe, expect, it } from 'vitest'
import { orderHomeCarousel, parseHomeCarouselSetting } from '@/lib/homeCarousel'

const articles = ['new', 'two', 'three', 'older'].map((id) => ({ id }))
const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

describe('homepage carousel: recency takes priority over manual curation', () => {
  it('defaults to the newest three and stays within the rotation limit', () => {
    expect(ids(orderHomeCarousel(articles, null))).toEqual(['new', 'two', 'three'])
  })
  it('respects an administrator\'s exact manual order and replacement', () => {
    expect(ids(orderHomeCarousel(articles, { newestId: 'new', ids: ['older', 'three', 'new'] })))
      .toEqual(['older', 'three', 'new'])
  })
  it('expires a manual order as soon as a newer article is published', () => {
    const afterPublication = [{ id: 'brand-new' }, ...articles]
    expect(ids(orderHomeCarousel(afterPublication, { newestId: 'new', ids: ['older', 'three', 'new'] })))
      .toEqual(['brand-new', 'new', 'two'])
  })
  it('never renders missing article IDs, and fills available slots with the newest eligible stories', () => {
    expect(ids(orderHomeCarousel(articles, { newestId: 'new', ids: ['withdrawn', 'older'] })))
      .toEqual(['older', 'new', 'two'])
  })
  it('rejects invalid, duplicated or outsize configuration', () => {
    expect(parseHomeCarouselSetting('garbage')).toBeNull()
    expect(parseHomeCarouselSetting(JSON.stringify({ newestId: 'new', ids: ['new', 'new'] }))).toBeNull()
    expect(parseHomeCarouselSetting(JSON.stringify({ newestId: 'new', ids: ['1', '2', '3', '4'] }))).toBeNull()
    expect(parseHomeCarouselSetting(JSON.stringify({ newestId: 'new', ids: ['older'] })))
      .toEqual({ newestId: 'new', ids: ['older'] })
  })
})
