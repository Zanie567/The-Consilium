'use client'

import { useEffect } from 'react'
import { initialArticleIntroScrollTop } from '@/lib/articleOpeningPosition'

/**
 * On a NEW article opening, show its headline and part of the lead image.
 * The photo itself stays above the reader in the normal scrollable document.
 *
 * This is intentionally not an anchor or an animated scroll: it must not change
 * the article URL, steal focus or fight section links / browser restoration.
 */
export function ArticleOpeningPosition({ articleId }: { articleId: string }) {
  useEffect(() => {
    if (window.location.hash || window.scrollY > 8) return

    // Full back/forward navigation may restore a previous reading position.
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (navigation?.type === 'back_forward') return

    let cancelled = false
    let frame1 = 0
    let frame2 = 0
    const cancel = () => { cancelled = true }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const name of events) window.addEventListener(name, cancel, { once: true, passive: true })

    // Wait for layout after hydration and the app router's own scroll-to-top.
    // Bail if another navigation or any reader input has already moved the page.
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        if (cancelled || window.scrollY > 8 || window.location.hash) return
        const heading = document.querySelector<HTMLElement>('[data-article-opening-headline]')
        if (!heading) return
        const rect = heading.getBoundingClientRect()
        const target = initialArticleIntroScrollTop({
          headlineDocumentTop: rect.top + window.scrollY,
          headlineHeight: rect.height,
          viewportHeight: window.innerHeight,
          maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        })
        if (target === null) return
        // CSS globally sets scroll-behavior:smooth. Do NOT play a camera-like
        // scroll on every page entry: snap to the initial reading composition.
        const root = document.documentElement
        const previous = root.style.scrollBehavior
        root.style.scrollBehavior = 'auto'
        try {
          window.scrollTo({ top: target, behavior: 'instant' })
        } finally {
          root.style.scrollBehavior = previous
        }
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame1)
      cancelAnimationFrame(frame2)
      for (const name of events) window.removeEventListener(name, cancel)
    }
  }, [articleId])

  return null
}
