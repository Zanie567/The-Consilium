/**
 * Editorial opening position for an article with a large lead image.
 *
 * Leave the banner in the actual document (scrolling UP reveals all of it),
 * but make the headline visible on initial entry. No hard-coded scroll offset:
 * heading size, font wrapping and viewport dimensions can all vary.
 */
export function initialArticleIntroScrollTop({
  headlineDocumentTop,
  headlineHeight,
  viewportHeight,
  maxScroll,
}: {
  headlineDocumentTop: number
  headlineHeight: number
  viewportHeight: number
  maxScroll: number
}): number | null {
  if (![headlineDocumentTop, headlineHeight, viewportHeight, maxScroll].every(Number.isFinite)) return null
  if (viewportHeight < 380 || headlineDocumentTop < 0 || headlineHeight <= 0 || maxScroll <= 0) return null

  // Position the heading in the lower two-thirds while allowing a long,
  // multi-line headline to remain visible above the bottom of the viewport.
  const titleTop = Math.max(
    90,
    Math.min(viewportHeight * 0.66, viewportHeight - headlineHeight - Math.min(68, viewportHeight * 0.09)),
  )
  const offset = Math.max(0, Math.min(Math.round(headlineDocumentTop - titleTop), maxScroll))
  // If it already fits comfortably, do not scroll the reader just for effect.
  return offset > 16 ? offset : null
}
