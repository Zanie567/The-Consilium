import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor, NodeViewRendererProps } from '@tiptap/core'
import { renderLatexInto } from '@/lib/math/latex'

/**
 * The official Tiptap mathematics nodes (inlineMath / blockMath, LaTeX stored in
 * attrs.latex), adapted for The Consilium:
 *
 *   * No input rules. The stock rules turn "$$…$$" typed in a paragraph into
 *     maths; an economics publication types dollar signs constantly, so equations
 *     are only ever created deliberately, from the Σ equation dialog.
 *   * Node views render through renderLatexInto (src/lib/math/latex.ts), the same
 *     safe, size-limited path the public renderer uses, so the editor shows
 *     exactly what readers will see and a hostile stored formula cannot hang a
 *     reviewer's browser. An equation that cannot be typeset shows its source,
 *     flagged, so nothing is ever hidden or lost.
 *   * Clicking an equation, or pressing Enter while one is selected, asks the
 *     editor to open the equation dialog (onEdit). Read-only editors (review,
 *     preview) never do.
 *   * renderText gives plain-text copies the LaTeX source instead of nothing.
 */

export type MathEditTarget = { kind: 'inline' | 'display'; latex: string; pos: number }

export interface ArticleMathOptions {
  onEdit?: (target: MathEditTarget) => void
}

function mathNodeView(kind: 'inline' | 'display', editor: Editor, onEdit: ArticleMathOptions['onEdit']) {
  return ({ node, getPos }: NodeViewRendererProps) => {
    let current: ProseMirrorNode = node
    const dom: HTMLElement = document.createElement(kind === 'inline' ? 'span' : 'div')
    const render = () => {
      const latex = String(current.attrs.latex ?? '')
      const result = renderLatexInto(dom, latex, kind === 'display')
      dom.className = `tiptap-math tiptap-math--${kind}${result.ok ? '' : ' tiptap-math--error'}${editor.isEditable ? ' tiptap-math--editable' : ''}`
      dom.dataset.type = kind === 'inline' ? 'inline-math' : 'block-math'
      dom.dataset.latex = latex
      if (result.ok) {
        dom.title = editor.isEditable ? 'Edit equation' : ''
      } else {
        dom.textContent = latex || '(empty equation)'
        dom.title = editor.isEditable ? `This equation cannot be typeset: ${result.error} Click to fix it.` : result.error
      }
    }
    const onClick = (event: MouseEvent) => {
      if (!editor.isEditable || !onEdit) return
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (typeof pos !== 'number') return
      event.preventDefault()
      onEdit({ kind, latex: String(current.attrs.latex ?? ''), pos })
    }
    // KaTeX output is not editable text; ProseMirror treats the equation as one unit.
    dom.setAttribute('contenteditable', 'false')
    dom.addEventListener('click', onClick)
    render()
    return {
      dom,
      update(next: ProseMirrorNode) {
        if (next.type !== current.type) return false
        if (next.attrs.latex !== current.attrs.latex) {
          current = next
          render()
        }
        current = next
        return true
      },
      // KaTeX's DOM is static output; ProseMirror must not try to read it back.
      ignoreMutation: () => true,
      destroy() {
        dom.removeEventListener('click', onClick)
      },
    }
  }
}

function editSelectedMath(editor: Editor, typeName: string, kind: 'inline' | 'display', onEdit: ArticleMathOptions['onEdit']) {
  const { selection } = editor.state
  if (!editor.isEditable || !onEdit || !(selection instanceof NodeSelection) || selection.node.type.name !== typeName) {
    return false
  }
  onEdit({ kind, latex: String(selection.node.attrs.latex ?? ''), pos: selection.from })
  return true
}

export const ArticleInlineMath = InlineMath.extend<ArticleMathOptions>({
  addOptions() {
    return { ...this.parent?.(), onEdit: undefined }
  },
  addInputRules() {
    return []
  },
  renderText({ node }) {
    return String(node.attrs.latex ?? '')
  },
  addNodeView() {
    return mathNodeView('inline', this.editor, this.options.onEdit)
  },
  addKeyboardShortcuts() {
    return { Enter: () => editSelectedMath(this.editor, this.name, 'inline', this.options.onEdit) }
  },
})

export const ArticleBlockMath = BlockMath.extend<ArticleMathOptions>({
  addOptions() {
    return { ...this.parent?.(), onEdit: undefined }
  },
  addInputRules() {
    return []
  },
  renderText({ node }) {
    return `\n${String(node.attrs.latex ?? '')}\n`
  },
  addNodeView() {
    return mathNodeView('display', this.editor, this.options.onEdit)
  },
  addKeyboardShortcuts() {
    return { Enter: () => editSelectedMath(this.editor, this.name, 'display', this.options.onEdit) }
  },
})
