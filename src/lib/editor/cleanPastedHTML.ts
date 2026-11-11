import { safeContentUrl } from '@/lib/richMetadata'

const ALLOWED = new Set([
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'a',
  'blockquote',
  'ol',
  'ul',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'hr',
  'img',
  'pre',
  'code',
])
const DROP =
  'script,style,meta,link,iframe,object,embed,svg,math,form,input,button,textarea,select,template,noscript'

const MATH_TYPES: Record<string, string> = { span: 'inline-math', div: 'block-math' }

function mathElement(doc: Document, latex: string, display: boolean): HTMLElement {
  const el = doc.createElement(display ? 'div' : 'span')
  el.setAttribute('data-type', display ? 'block-math' : 'inline-math')
  el.setAttribute('data-latex', latex)
  return el
}

/**
 * Typeset equations copied from a web page (KaTeX or MathJax output, including
 * The Consilium's own articles, and Wikipedia) carry their LaTeX source in a
 * MathML annotation. Each becomes an editable equation node instead of being
 * dropped with the rest of the <math> markup. MathML without a LaTeX source
 * cannot be converted faithfully and is dropped as before.
 */
function convertTypesetMath(doc: Document) {
  doc.body.querySelectorAll('math').forEach((math) => {
    if (!math.isConnected) return
    const latex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    if (!latex) return
    const display =
      math.getAttribute('display') === 'block' || Boolean(math.closest('.katex-display, .math-display, mjx-container[display="true"]'))
    const host =
      math.closest('.math-display, .math-inline') ??
      math.closest('.mwe-math-element') ??
      math.closest('.katex-display') ??
      math.closest('.katex') ??
      math.closest('mjx-container') ??
      math
    host.replaceWith(mathElement(doc, latex, display))
  })
}

/** Clipboard conversion, not a substitute for the public/server sanitiser. */
export function cleanPastedHTML(html: string): string {
  const doc = new window.DOMParser().parseFromString(html.slice(0, 2_000_000), 'text/html')
  convertTypesetMath(doc)
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove())
  doc.body.querySelectorAll('[id*="cmnt"], [id*="ftnt"]').forEach((el) => el.remove())
  // Google Docs wraps its whole clipboard in a bold element styled normal.
  doc.body.querySelectorAll('b[style]').forEach((el) => {
    if (
      (el as HTMLElement).style.fontWeight === 'normal' ||
      (el as HTMLElement).style.fontWeight === '400'
    )
      el.replaceWith(...el.childNodes)
  })
  const clean = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    // Equation nodes (the editor's own clipboard, or converted above) keep only
    // their type and LaTeX source; the editor renders them afresh.
    const mathType = el.getAttribute('data-type')
    if (mathType && MATH_TYPES[tag] === mathType) {
      const latex = el.getAttribute('data-latex') ?? ''
      if (!latex.trim()) {
        el.remove()
        return
      }
      Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name))
      el.replaceChildren()
      el.setAttribute('data-type', mathType)
      el.setAttribute('data-latex', latex)
      return
    }
    Array.from(el.children).forEach(clean)
    const style = (el as HTMLElement).style
    const wrappers: string[] = []
    if (
      style &&
      (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) &&
      !['b', 'strong'].includes(tag)
    )
      wrappers.push('strong')
    if (style?.fontStyle === 'italic' && !['em', 'i'].includes(tag)) wrappers.push('em')
    if (wrappers.length) {
      // Keep the original structural element/link; wrap its children only.
      const fragment = doc.createDocumentFragment()
      while (el.firstChild) fragment.append(el.firstChild)
      let content: Node = fragment
      for (const wrapper of wrappers.reverse()) {
        const mark = doc.createElement(wrapper)
        mark.append(content)
        content = mark
      }
      el.append(content)
    }
    const attrs: Record<string, string> = {}
    if (tag === 'a') {
      const href = safeContentUrl(el.getAttribute('href'), true)
      if (href) attrs.href = href
    }
    if (tag === 'img') {
      const src = safeContentUrl(el.getAttribute('src'))
      if (!src) {
        el.remove()
        return
      }
      attrs.src = src
      attrs.alt = el.getAttribute('alt') ?? ''
    }
    if (tag === 'td' || tag === 'th')
      for (const name of ['colspan', 'rowspan']) {
        const value = Number(el.getAttribute(name))
        if (Number.isInteger(value) && value > 1 && value <= 100) attrs[name] = String(value)
      }
    if (tag === 'ol') {
      const start = Number(el.getAttribute('start'))
      if (Number.isInteger(start) && start > 0 && start <= 100000) attrs.start = String(start)
    }
    Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name))
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value)
    if (!ALLOWED.has(tag)) el.replaceWith(...el.childNodes)
  }
  Array.from(doc.body.children).forEach(clean)
  // Typical Docs tables use bold cells for their header row, without <th>.
  doc.body.querySelectorAll('table').forEach((table) => {
    const first = table.querySelector('tr')
    if (
      first &&
      first.children.length &&
      Array.from(first.children).every(
        (cell) => cell.querySelector('strong,b') && cell.textContent?.trim()
      )
    ) {
      Array.from(first.children).forEach((cell) => {
        if (cell.tagName === 'TD') {
          const th = doc.createElement('th')
          for (const attr of cell.attributes) th.setAttribute(attr.name, attr.value)
          th.append(...cell.childNodes)
          cell.replaceWith(th)
        }
      })
    }
  })
  return doc.body.innerHTML.replace(/\u00a0/g, ' ')
}
