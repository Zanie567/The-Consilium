import { renderLatex } from '@/lib/math/latex'

export interface InvalidEquation {
  /** 1-based position among the document's equations, in reading order. */
  number: number
  latex: string
  error: string
}

/**
 * Equations in stored Tiptap JSON that cannot be typeset. The equation dialog
 * never inserts one, but pasted or older content can contain them; the editor
 * runs this before an article is submitted or published so broken maths is
 * fixed rather than published (the public page would show its LaTeX source).
 */
export function findInvalidEquations(content: string): InvalidEquation[] {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return []
  }
  const invalid: InvalidEquation[] = []
  let number = 0
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: unknown; attrs?: { latex?: unknown }; content?: unknown }
    if (n.type === 'inlineMath' || n.type === 'blockMath') {
      number++
      const latex = typeof n.attrs?.latex === 'string' ? n.attrs.latex : ''
      const result = renderLatex(latex, n.type === 'blockMath')
      if (!result.ok) invalid.push({ number, latex, error: result.error })
    }
    if (Array.isArray(n.content)) n.content.forEach(visit)
  }
  visit(doc)
  return invalid
}

/** One message for an error banner: for the author in the editor, or for a reviewer publishing. */
export function invalidEquationsMessage(invalid: InvalidEquation[], audience: 'author' | 'reviewer' = 'author'): string {
  const [first] = invalid
  const which = invalid.length === 1 ? `Equation ${first.number}` : `${invalid.length} equations (the first is equation ${first.number})`
  const fix =
    audience === 'author'
      ? 'Click the equation outlined in red to fix it before submitting or publishing.'
      : 'Fix it in the editor, or return the article to the author, before publishing.'
  return `${which} cannot be typeset: ${first.error} ${fix}`
}
