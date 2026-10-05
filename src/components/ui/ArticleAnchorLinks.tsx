'use client'

import { useEffect } from 'react'

const ANCHOR_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function ArticleAnchorLinks({ containerSelector }: { containerSelector: string }) {
  useEffect(() => {
    const container = document.querySelector(containerSelector)
    if (!container) return

    const headings = [...container.querySelectorAll<HTMLElement>('h2, h3')]
    const fresh = new Set(headings.filter(heading => !heading.querySelector('.anchor-link')))
    const used = new Set([...document.querySelectorAll<HTMLElement>('[id]')]
      .filter(element => !fresh.has(element)).map(element => element.id))
    const owned: { heading: HTMLElement; anchor: HTMLAnchorElement; originalId: string; id: string }[] = []
    const controller = new AbortController()
    const feedback = document.createElement('div')
    feedback.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] bg-navy text-cream border border-gold/30 px-4 py-3 shadow-xl text-sm'
    feedback.hidden = true
    document.body.appendChild(feedback)
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const showFeedback = (message: string, ok: boolean) => {
      if (timer !== undefined) clearTimeout(timer)
      feedback.setAttribute('role', ok ? 'status' : 'alert')
      feedback.textContent = message
      feedback.hidden = false
      if (ok) timer = setTimeout(() => { feedback.hidden = true }, 3000)
    }

    for (const heading of headings) {
      if (!fresh.has(heading)) continue
      const text = heading.textContent ?? ''
      const base = slugify(text) || 'section'
      let id = base
      let suffix = 2
      while (used.has(id)) id = `${base}-${suffix++}`
      used.add(id)
      const originalId = heading.id
      heading.id = id

      const anchor = document.createElement('a')
      anchor.href = `#${id}`
      anchor.className = 'anchor-link'
      anchor.setAttribute('aria-label', `Link to section: ${text}`)
      anchor.innerHTML = ANCHOR_SVG
      anchor.addEventListener('click', async event => {
        event.preventDefault()
        const current = ++request
        const url = `${window.location.pathname}#${id}`
        window.history.replaceState(null, '', url)
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        try {
          await navigator.clipboard.writeText(window.location.origin + url)
          if (!controller.signal.aborted && current === request) showFeedback('Section link copied.', true)
        } catch {
          if (!controller.signal.aborted && current === request) showFeedback('Section link could not be copied. Copy it from the address bar.', false)
        }
      }, { signal: controller.signal })
      heading.prepend(anchor)
      owned.push({ heading, anchor, originalId, id })
    }
    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
      feedback.remove()
      for (const { heading, anchor, originalId, id } of owned) {
        anchor.remove()
        if (heading.id === id) {
          if (originalId) heading.id = originalId
          else heading.removeAttribute('id')
        }
      }
    }

  }, [containerSelector])

  return null
}
