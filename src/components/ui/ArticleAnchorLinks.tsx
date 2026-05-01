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

    const headings = container.querySelectorAll<HTMLElement>('h2, h3')
    headings.forEach((heading) => {
      if (heading.querySelector('.anchor-link')) return

      const text = heading.textContent ?? ''
      const id = slugify(text)
      heading.id = id

      const anchor = document.createElement('a')
      anchor.href = `#${id}`
      anchor.className = 'anchor-link'
      anchor.setAttribute('aria-label', `Link to section: ${text}`)
      anchor.innerHTML = ANCHOR_SVG

      anchor.addEventListener('click', (e) => {
        e.preventDefault()
        const url = `${window.location.pathname}#${id}`
        navigator.clipboard.writeText(window.location.origin + url).catch(() => {})
        window.history.replaceState(null, '', url)
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })

      heading.prepend(anchor)
    })
  }, [containerSelector])

  return null
}
