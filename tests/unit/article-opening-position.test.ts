import { describe, expect, it } from 'vitest'
import { initialArticleIntroScrollTop } from '@/lib/articleOpeningPosition'

describe('initial article opening position', () => {
  it('shows a standard desktop headline while leaving most of the banner above it scrollable', () => {
    // 64px sticky navbar + 510px hero + attribution/spacing puts the heading low.
    const top = initialArticleIntroScrollTop({
      headlineDocumentTop: 760, headlineHeight: 125,
      viewportHeight: 900, maxScroll: 2500,
    })
    expect(top).toBe(166)
    // It is not a destructive crop: the cover remains above the initial viewport.
    expect(760 - (top ?? 0)).toBeLessThan(900)
  })

  it('does not shift articles whose heading already fits on screen', () => {
    expect(initialArticleIntroScrollTop({
      headlineDocumentTop: 260, headlineHeight: 110,
      viewportHeight: 900, maxScroll: 3000,
    })).toBeNull()
  })

  it('accounts for long multi-line headlines on narrow devices', () => {
    const top = initialArticleIntroScrollTop({
      headlineDocumentTop: 610, headlineHeight: 245,
      viewportHeight: 680, maxScroll: 2100,
    })
    expect(top).not.toBeNull()
    expect(610 - (top ?? 0) + 245).toBeLessThanOrEqual(680 - 40)
  })

  it('never scrolls beyond the document or for unusably small viewports', () => {
    expect(initialArticleIntroScrollTop({
      headlineDocumentTop: 1400, headlineHeight: 150,
      viewportHeight: 900, maxScroll: 150,
    })).toBe(150)
    expect(initialArticleIntroScrollTop({
      headlineDocumentTop: 800, headlineHeight: 120,
      viewportHeight: 310, maxScroll: 800,
    })).toBeNull()
    expect(initialArticleIntroScrollTop({
      headlineDocumentTop: 800, headlineHeight: 120,
      viewportHeight: 900, maxScroll: 0,
    })).toBeNull()
  })

  it('ignores invalid measurements rather than jumping to a bogus position', () => {
    expect(initialArticleIntroScrollTop({
      headlineDocumentTop: Number.NaN, headlineHeight: 90,
      viewportHeight: 900, maxScroll: 1500,
    })).toBeNull()
  })
})
