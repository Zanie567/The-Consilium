const INLINE_ELEMENTS = new Set([
  'span',
  'font',
  'b',
  'i',
  'u',
  's',
  'em',
  'strong',
  'a',
])

const ATTRIBUTE_ALLOWLIST = new Map<string, Set<string>>([
  ['a', new Set(['href'])],
  ['img', new Set(['src', 'alt'])],
  ['td', new Set(['rowspan', 'colspan'])],
  ['th', new Set(['rowspan', 'colspan'])],
  ['aside', new Set(['data-type', 'class'])],
])

function stripAttributes(element: Element) {
  if (element.matches('[id*="cmnt"], [id*="ftnt"], a[id]')) return

  const tagName = element.tagName.toLowerCase()
  const allowedAttributes = ATTRIBUTE_ALLOWLIST.get(tagName) ?? new Set<string>()

  Array.from(element.attributes).forEach((attribute) => {
    if (!allowedAttributes.has(attribute.name.toLowerCase())) {
      element.removeAttribute(attribute.name)
    }
  })
}

function getSemanticWrappers(element: HTMLElement): string[] {
  const wrappers: string[] = []
  const { fontWeight, fontStyle, textDecoration } = element.style

  if (/bold|700|800|900/.test(fontWeight)) wrappers.push('strong')
  if (/italic/.test(fontStyle)) wrappers.push('em')
  if (/line-through/.test(textDecoration)) {
    wrappers.push('s')
  } else if (/underline/.test(textDecoration)) {
    wrappers.push('u')
  }

  return wrappers
}

function replaceWithSemanticWrappers(element: HTMLElement, wrappers: string[]): HTMLElement {
  const doc = element.ownerDocument
  const createdWrappers = wrappers.map((tagName) => doc.createElement(tagName))
  const outermost = createdWrappers[0]
  const innermost = createdWrappers[createdWrappers.length - 1]

  createdWrappers.forEach((wrapper, index) => {
    const nextWrapper = createdWrappers[index + 1]
    if (nextWrapper) wrapper.appendChild(nextWrapper)
  })

  while (element.firstChild) {
    innermost.appendChild(element.firstChild)
  }

  element.replaceWith(outermost)
  return outermost
}

function cleanElement(element: Element) {
  Array.from(element.children).forEach(cleanElement)

  let currentElement = element
  const tagName = currentElement.tagName.toLowerCase()

  if (currentElement instanceof HTMLElement && INLINE_ELEMENTS.has(tagName)) {
    const wrappers = getSemanticWrappers(currentElement)
    if (wrappers.length > 0) {
      currentElement = replaceWithSemanticWrappers(currentElement, wrappers)
    }
  }

  stripAttributes(currentElement)
}

export function cleanPastedHTML(html: string): string {
  const doc = new window.DOMParser().parseFromString(html, 'text/html')
  const { body } = doc

  body.querySelectorAll('meta, style, script').forEach((element) => element.remove())

  Array.from(body.children).forEach((element) => {
    if (element.tagName.toLowerCase() !== 'b') return

    if (!(element instanceof HTMLElement)) return
    if (element.style.fontWeight.toLowerCase() !== 'normal') return

    while (element.firstChild) {
      body.insertBefore(element.firstChild, element)
    }
    element.remove()
  })

  Array.from(body.children).forEach(cleanElement)

  body.querySelectorAll('[id*="cmnt"], [id*="ftnt"], a[id]').forEach((element) => element.remove())

  body.querySelectorAll('span').forEach((element) => {
    if (element.attributes.length === 0 && element.textContent?.trim().length === 0) {
      element.remove()
    }
  })

  const result = body.innerHTML

  return result.replace(/\u2014/g, ' - ').replace(/\u00a0/g, ' ')
}
