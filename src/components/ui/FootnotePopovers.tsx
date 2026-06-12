'use client'

import { useEffect } from 'react'

/**
 * Progressive enhancement for footnote markers rendered server-side by
 * src/lib/articleRender.ts. The server emits
 * <sup class="footnote-ref" id="fnref-n" data-index="n" data-footnote="<uri-encoded text>">
 *   <a href="#fn-n">[n]</a>
 * </sup>
 * plus a references list whose entries are <li id="fn-n"> with a
 * .footnote-backlink anchor pointing back at the marker. This component adds:
 *
 *   * hover (and keyboard focus) shows a small card with the footnote text
 *   * on touch, tap toggles the card and tapping anywhere else dismisses it
 *   * Escape dismisses, focus is never trapped or moved while the card is open
 *   * mouse click and Enter on a marker smooth-scroll to the list entry and
 *     flash it; back-links return to the marker the same way
 *
 * One card element is reused for every marker. It is position: fixed and
 * appended to <body>, so opening it never shifts article layout, and its
 * position is clamped to the viewport so it cannot overflow on mobile.
 * Footnote text is set via textContent only; the data attribute is never
 * interpreted as HTML. Without JavaScript the markers still work as ordinary
 * in-page anchors.
 */
export function FootnotePopovers({ containerSelector }: { containerSelector: string }) {
  useEffect(() => {
    const container = document.querySelector(containerSelector)
    if (!container) return

    const markers = Array.from(
      container.querySelectorAll<HTMLElement>('sup.footnote-ref[data-footnote]')
    )
    if (markers.length === 0) return

    const tip = document.createElement('div')
    tip.className = 'footnote-popover'
    tip.id = 'footnote-popover'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.appendChild(tip)

    let current: HTMLElement | null = null
    let hideTimer: number | undefined
    let flashTimer: number | undefined
    let flashed: HTMLElement | null = null

    const footnoteText = (el: HTMLElement): string => {
      const raw = el.getAttribute('data-footnote') ?? ''
      try {
        return decodeURIComponent(raw)
      } catch {
        // Malformed percent-encoding cannot come from our renderer, but if it
        // ever does, showing the raw value beats showing nothing.
        return raw
      }
    }

    const fill = (el: HTMLElement) => {
      tip.textContent = ''
      const label = document.createElement('p')
      label.className = 'footnote-popover-label'
      label.textContent = `Footnote ${el.getAttribute('data-index') ?? ''}`
      const text = document.createElement('p')
      text.className = 'footnote-popover-text'
      text.textContent = footnoteText(el)
      tip.append(label, text)
    }

    const position = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const margin = 8
      const gap = 8
      const width = tip.offsetWidth
      const height = tip.offsetHeight
      // documentElement.clientWidth, not window.innerWidth: when some other
      // element overflows horizontally on a small screen, innerWidth reports
      // the inflated layout width and the clamp would let the card hang off
      // the real (visual) viewport.
      const viewportWidth = document.documentElement.clientWidth
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(margin, Math.min(left, viewportWidth - width - margin))
      let top = rect.top - height - gap
      if (top < margin) top = rect.bottom + gap
      tip.style.left = `${Math.round(left)}px`
      tip.style.top = `${Math.round(top)}px`
    }

    const linkOf = (el: HTMLElement) => el.querySelector<HTMLAnchorElement>('a')

    const cancelScheduledHide = () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
        hideTimer = undefined
      }
    }

    const show = (el: HTMLElement) => {
      cancelScheduledHide()
      if (current === el && !tip.hidden) return
      if (current && current !== el) {
        linkOf(current)?.removeAttribute('aria-describedby')
      }
      current = el
      fill(el)
      // Measure invisibly first so the card never flashes at a stale position.
      tip.style.visibility = 'hidden'
      tip.hidden = false
      position(el)
      tip.style.visibility = ''
      linkOf(el)?.setAttribute('aria-describedby', tip.id)
    }

    const hide = () => {
      cancelScheduledHide()
      if (current) {
        linkOf(current)?.removeAttribute('aria-describedby')
      }
      current = null
      tip.hidden = true
    }

    const scheduleHide = () => {
      cancelScheduledHide()
      // Small grace period so the pointer can travel into the card without it
      // vanishing.
      hideTimer = window.setTimeout(hide, 150)
    }

    const prefersReducedMotion = () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const flash = (el: HTMLElement) => {
      if (flashTimer !== undefined) window.clearTimeout(flashTimer)
      flashed?.classList.remove('footnote-flash')
      flashed = el
      el.classList.add('footnote-flash')
      flashTimer = window.setTimeout(() => {
        el.classList.remove('footnote-flash')
        flashed = null
        flashTimer = undefined
      }, 1800)
    }

    // Shared by marker clicks and back-link clicks: scroll the target into
    // view, flash it, move focus to it (without trapping, it is just a normal
    // focus move) and record the hash so the URL stays shareable.
    const jumpTo = (targetId: string, href: string) => {
      const target = document.getElementById(targetId)
      if (!target) return false
      hide()
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      })
      flash(target)
      const focusable =
        target instanceof HTMLAnchorElement ? target : target.querySelector<HTMLElement>('a') ?? target
      focusable.focus({ preventScroll: true })
      history.replaceState(null, '', href)
      return true
    }

    const controller = new AbortController()
    const { signal } = controller

    // A tap fires pointerdown then click; remember the pointer type so the
    // click handler can tell a touch tap (toggle the card) from a mouse click
    // or keyboard activation (jump to the references list).
    let lastPointerType = ''
    document.addEventListener(
      'pointerdown',
      (e) => {
        lastPointerType = e.pointerType
      },
      { signal, capture: true }
    )

    for (const el of markers) {
      const link = linkOf(el)

      el.addEventListener(
        'pointerenter',
        (e) => {
          if (e.pointerType === 'mouse') show(el)
        },
        { signal }
      )
      el.addEventListener(
        'pointerleave',
        (e) => {
          if (e.pointerType === 'mouse') scheduleHide()
        },
        { signal }
      )

      if (!link) continue
      link.addEventListener(
        'focus',
        () => {
          if (link.matches(':focus-visible')) show(el)
        },
        { signal }
      )
      link.addEventListener('blur', scheduleHide, { signal })
      link.addEventListener(
        'click',
        (e) => {
          e.preventDefault()
          if (lastPointerType === 'touch' || lastPointerType === 'pen') {
            lastPointerType = ''
            if (current === el && !tip.hidden) hide()
            else show(el)
            return
          }
          lastPointerType = ''
          const index = el.getAttribute('data-index') ?? ''
          jumpTo(`fn-${index}`, `#fn-${index}`)
        },
        { signal }
      )
    }

    // Back-links live in the references list below the article body.
    const backlinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a.footnote-backlink')
    )
    for (const back of backlinks) {
      back.addEventListener(
        'click',
        (e) => {
          const targetId = (back.getAttribute('href') ?? '').replace(/^#/, '')
          if (jumpTo(targetId, `#${targetId}`)) e.preventDefault()
        },
        { signal }
      )
    }

    tip.addEventListener('mouseenter', cancelScheduledHide, { signal })
    tip.addEventListener('mouseleave', scheduleHide, { signal })

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && current) hide()
      },
      { signal }
    )
    // Tapping or clicking anywhere outside the marker and the card dismisses.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (tip.hidden) return
        const target = e.target as Node
        if (tip.contains(target) || (current && current.contains(target))) return
        hide()
      },
      { signal }
    )
    // Keep the card anchored while the page scrolls or resizes under it.
    window.addEventListener(
      'scroll',
      () => {
        if (current && !tip.hidden) position(current)
      },
      { signal, passive: true, capture: true }
    )
    window.addEventListener(
      'resize',
      () => {
        if (current && !tip.hidden) position(current)
      },
      { signal }
    )

    return () => {
      controller.abort()
      if (flashTimer !== undefined) window.clearTimeout(flashTimer)
      flashed?.classList.remove('footnote-flash')
      tip.remove()
    }
  }, [containerSelector])

  return null
}
