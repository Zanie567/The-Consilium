'use client'

import { useEffect } from 'react'

/**
 * Progressive enhancement for glossary tooltip triggers injected server-side
 * by src/lib/glossary/linkify.ts. The server emits inert
 * <span class="glossary-term" data-gloss-term data-gloss-def [data-gloss-url]>
 * elements; this component makes them interactive:
 *
 *   * hover (and keyboard focus) shows a small definition card
 *   * on touch, tap toggles it and tapping anywhere else dismisses it
 *   * Enter / Space toggle, Escape dismisses
 *   * triggers get tabindex, role="button" and aria-expanded here, and
 *     aria-describedby points at the card while it is open
 *
 * One card element is reused for every term. It is position: fixed and
 * appended to <body>, so opening it never shifts article layout, and its
 * position is clamped to the viewport so it cannot overflow on mobile.
 * Definition text is set via textContent only; nothing from the data
 * attributes is ever interpreted as HTML.
 */
export function GlossaryTooltips({ containerSelector }: { containerSelector: string }) {
  useEffect(() => {
    const container = document.querySelector(containerSelector)
    if (!container) return

    const triggers = Array.from(
      container.querySelectorAll<HTMLElement>('span.glossary-term[data-gloss-def]')
    )
    if (triggers.length === 0) return

    const tip = document.createElement('div')
    tip.className = 'glossary-tooltip'
    tip.id = 'glossary-tooltip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    document.body.appendChild(tip)

    let current: HTMLElement | null = null
    let hideTimer: number | undefined

    const cancelScheduledHide = () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
        hideTimer = undefined
      }
    }

    const fill = (el: HTMLElement) => {
      tip.textContent = ''
      const name = document.createElement('p')
      name.className = 'glossary-tooltip-term'
      name.textContent = el.getAttribute('data-gloss-term') ?? ''
      const def = document.createElement('p')
      def.className = 'glossary-tooltip-def'
      def.textContent = el.getAttribute('data-gloss-def') ?? ''
      tip.append(name, def)
      const url = el.getAttribute('data-gloss-url')
      if (url && /^https?:\/\//i.test(url)) {
        const link = document.createElement('a')
        link.href = url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.className = 'glossary-tooltip-link'
        link.textContent = 'Learn more'
        tip.append(link)
      }
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

    const show = (el: HTMLElement) => {
      cancelScheduledHide()
      if (current === el && !tip.hidden) return
      if (current && current !== el) {
        current.setAttribute('aria-expanded', 'false')
        current.removeAttribute('aria-describedby')
      }
      current = el
      fill(el)
      // Measure invisibly first so the card never flashes at a stale position.
      tip.style.visibility = 'hidden'
      tip.hidden = false
      position(el)
      tip.style.visibility = ''
      el.setAttribute('aria-expanded', 'true')
      el.setAttribute('aria-describedby', tip.id)
    }

    const hide = () => {
      cancelScheduledHide()
      if (current) {
        current.setAttribute('aria-expanded', 'false')
        current.removeAttribute('aria-describedby')
      }
      current = null
      tip.hidden = true
    }

    const scheduleHide = () => {
      cancelScheduledHide()
      // Small grace period so the pointer can travel into the card (to reach
      // the learn more link) without it vanishing.
      hideTimer = window.setTimeout(hide, 150)
    }

    const controller = new AbortController()
    const { signal } = controller

    for (const el of triggers) {
      el.setAttribute('tabindex', '0')
      el.setAttribute('role', 'button')
      el.setAttribute('aria-expanded', 'false')

      // Hover only for real mouse pointers: a tap on a touch screen synthesises
      // mouseenter, focus, AND click, which would open the card and instantly
      // toggle it closed again. Touch relies on the click handler alone.
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
      // Keyboard focus only (:focus-visible is false for pointer-driven focus).
      el.addEventListener(
        'focus',
        () => {
          if (el.matches(':focus-visible')) show(el)
        },
        { signal }
      )
      el.addEventListener('blur', scheduleHide, { signal })
      el.addEventListener(
        'click',
        (e) => {
          e.stopPropagation()
          if (current === el && !tip.hidden) hide()
          else show(el)
        },
        { signal }
      )
      el.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (current === el && !tip.hidden) hide()
            else show(el)
          }
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
    // Tapping or clicking anywhere outside the trigger and the card dismisses.
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
      tip.remove()
    }
  }, [containerSelector])

  return null
}
