// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Editor, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { ArticleBlockMath, ArticleInlineMath, type MathEditTarget } from '@/components/editor/extensions/ArticleMath'
import { cleanPastedHTML } from '@/lib/editor/cleanPastedHTML'
import { unsupportedContentTypes } from '@/lib/editor/unsupportedContent'
import { findInvalidEquations, invalidEquationsMessage } from '@/lib/math/contentEquations'
import { applyTemplate, MATH_TEMPLATE_GROUPS } from '@/lib/math/templates'
import { renderContent } from '@/lib/articleRender'

vi.mock('@/lib/editorFont', () => ({ editorFont: { variable: 'editor-font' } }))

// jsdom has no layout; ProseMirror measures ranges when it scrolls the selection into view.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
Element.prototype.getClientRects ??= emptyRects

/**
 * Equation behaviour in the editor: the Tiptap nodes and commands the editor uses,
 * the node views, keyboard and click editing, clipboard round trips, and the real
 * TiptapEditor component with its equation dialog.
 */

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string }

function makeEditor(content: unknown, onEdit?: (t: MathEditTarget) => void, editable = true) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    editable,
    extensions: [StarterKit, ArticleInlineMath.configure({ onEdit }), ArticleBlockMath.configure({ onEdit })],
    content: content as Json,
  })
}

const doc = (...content: Json[]): Json => ({ type: 'doc', content })
const p = (...content: Json[]): Json => ({ type: 'paragraph', content })
const t = (text: string): Json => ({ type: 'text', text })
const im = (latex: string): Json => ({ type: 'inlineMath', attrs: { latex } })
const bm = (latex: string): Json => ({ type: 'blockMath', attrs: { latex } })

function positionOf(editor: Editor, type: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos
  })
  return found
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('equation nodes and commands', () => {
  it('inserts an inline equation at the cursor inside a paragraph (A) and serialises it as JSON (G)', () => {
    const editor = makeEditor(doc(p(t('Set  in equilibrium.'))))
    editor.commands.setTextSelection(5)
    editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex: 'MR = MC' } }).run()
    expect(editor.getJSON()).toEqual(doc(p(t('Set '), im('MR = MC'), t(' in equilibrium.'))))
    // The cursor sits just after the equation, ready to keep typing.
    expect(editor.state.selection.from).toBe(6)
    editor.destroy()
  })

  it('inserts a display equation between paragraphs (B)', () => {
    const editor = makeEditor(doc(p(t('Output')), p(t('is defined as'))))
    editor.commands.setTextSelection(7) // end of first paragraph
    editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: 'Y = C + I + G + (X - M)' } }).run()
    expect(editor.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(editor.getJSON().content?.[1]).toEqual(bm('Y = C + I + G + (X - M)'))
    editor.destroy()
  })

  it('edits (C), deletes (D), undoes and redoes (E) equations', () => {
    const editor = makeEditor(doc(p(t('A '), im('x^2'), t(' B'))))
    const pos = positionOf(editor, 'inlineMath')
    // Each step is its own undo step, as separate author actions would be.
    editor.commands.command(({ tr }) => {
      closeHistory(tr)
      tr.setNodeMarkup(pos, undefined, { latex: '\\frac{a}{b}' })
      return true
    })
    expect(editor.getJSON()).toEqual(doc(p(t('A '), im('\\frac{a}{b}'), t(' B'))))
    editor.commands.command(({ tr }) => {
      closeHistory(tr)
      tr.delete(pos, pos + 1)
      return true
    })
    expect(editor.getJSON()).toEqual(doc(p(t('A  B'))))
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(doc(p(t('A '), im('\\frac{a}{b}'), t(' B'))))
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(doc(p(t('A '), im('x^2'), t(' B'))))
    editor.commands.redo()
    editor.commands.redo()
    expect(editor.getJSON()).toEqual(doc(p(t('A  B'))))
    editor.destroy()
  })

  it('survives save and reload unchanged (F)', () => {
    const original = doc(p(t('Regression: '), im('Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i')), bm('\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}'), p(t('$5 and $10')))
    const first = makeEditor(original)
    const saved = JSON.stringify(first.getJSON())
    first.destroy()
    const reopened = makeEditor(JSON.parse(saved))
    expect(reopened.getJSON()).toEqual(original)
    // Still editable after reopening.
    const pos = positionOf(reopened, 'blockMath')
    reopened.commands.command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { latex: '\\sum_{i=1}^{n} x_i' })
      return true
    })
    expect(reopened.getJSON().content?.[1]).toEqual(bm('\\sum_{i=1}^{n} x_i'))
    reopened.destroy()
  })

  it('never turns typed dollar signs into maths', () => {
    const editor = makeEditor(doc(p(t('Costs $$5$'))))
    const end = editor.state.doc.content.size - 1
    editor.commands.setTextSelection(end)
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, end, end, '$', () => editor.state.tr))
    if (!handled) editor.commands.insertContent('$')
    expect(editor.getJSON()).toEqual(doc(p(t('Costs $$5$$'))))
    expect(JSON.stringify(editor.getJSON())).not.toContain('Math')
    editor.destroy()
  })

  it('gives plain-text copies the LaTeX source', () => {
    const editor = makeEditor(doc(p(t('Where '), im('MR = MC'), t('.')), bm('Y = C + I')))
    expect(editor.getText()).toContain('Where MR = MC.')
    expect(editor.getText()).toContain('Y = C + I')
    editor.destroy()
  })
})

describe('equation node views', () => {
  it('typesets with KaTeX, including MathML for screen readers', () => {
    const editor = makeEditor(doc(p(t('Inline '), im('\\alpha + \\beta')), bm('\\frac{\\partial U}{\\partial x}')))
    const inline = editor.view.dom.querySelector('span.tiptap-math--inline')!
    const display = editor.view.dom.querySelector('div.tiptap-math--display')!
    expect(inline.querySelector('.katex math annotation')?.textContent).toBe('\\alpha + \\beta')
    expect(display.querySelector('.katex-display')).not.toBeNull()
    expect(inline.getAttribute('contenteditable')).toBe('false')
    editor.destroy()
  })

  it('shows malformed LaTeX as flagged source, never hiding or dropping it (K)', () => {
    const editor = makeEditor(doc(p(im('\\frac{a')), bm('\\href{javascript:alert(1)}{x}')))
    const views = editor.view.dom.querySelectorAll('.tiptap-math--error')
    expect(views).toHaveLength(2)
    expect(views[0].textContent).toBe('\\frac{a')
    expect(views[0].getAttribute('title')).toContain('missing its closing')
    expect(views[1].querySelector('a')).toBeNull()
    expect(editor.getJSON()).toEqual(doc(p(im('\\frac{a')), bm('\\href{javascript:alert(1)}{x}')))
    editor.destroy()
  })

  it('opens the editor on click and on Enter, but never in a read-only preview', () => {
    const onEdit = vi.fn()
    const editor = makeEditor(doc(p(t('A '), im('x'))), onEdit)
    const view = editor.view.dom.querySelector<HTMLElement>('.tiptap-math')!
    view.click()
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'inline', latex: 'x', pos: 3 })

    editor.commands.setNodeSelection(3)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onEdit).toHaveBeenCalledTimes(2)
    // Enter in ordinary text still splits the paragraph.
    editor.commands.setTextSelection(2)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.destroy()

    const readOnlyEdit = vi.fn()
    const preview = makeEditor(doc(p(im('x'))), readOnlyEdit, false)
    preview.view.dom.querySelector<HTMLElement>('.tiptap-math')!.click()
    expect(readOnlyEdit).not.toHaveBeenCalled()
    expect(preview.view.dom.querySelector('.tiptap-math--editable')).toBeNull()
    preview.destroy()
  })
})

describe('copy and paste (R)', () => {
  const schema = getSchema([StarterKit, ArticleInlineMath, ArticleBlockMath])
  const parse = (html: string) => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = cleanPastedHTML(html)
    return ProseMirrorDOMParser.fromSchema(schema).parse(wrapper).toJSON() as Json
  }

  it('round-trips equations through the editor clipboard and the paste cleaner', () => {
    const source = schema.nodeFromJSON(doc(p(t('Set '), im('MR = MC')), bm('\\sum_{i=1}^{n} x_i')))
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(source.content)
    const container = document.createElement('div')
    container.appendChild(fragment)
    // The editor's clipboard HTML carries extra attributes; the cleaner keeps only type and LaTeX.
    const html = container.innerHTML.replace('<span ', '<span data-pm-slice="1 1 []" style="color:red" ')
    expect(parse(html)).toEqual(doc(p(t('Set '), im('MR = MC')), bm('\\sum_{i=1}^{n} x_i')))
  })

  it('turns equations copied from a published article back into editable equations', () => {
    const { html } = renderContent(JSON.stringify(doc(p(t('Profit peaks where '), im('MR = MC'), t('.')), bm('Y = C + I + G'))))
    expect(parse(html)).toEqual(doc(p(t('Profit peaks where '), im('MR = MC'), t('.')), bm('Y = C + I + G')))
  })

  it('converts MathML with a TeX annotation (e.g. Wikipedia) and drops MathML without one', () => {
    const wiki =
      '<p>Growth <span class="mwe-math-element"><span class="mwe-math-mathml-inline"><math alttext="g"><semantics><mi>g</mi>' +
      '<annotation encoding="application/x-tex">{\\displaystyle g}</annotation></semantics></math></span>' +
      '<img class="mwe-math-fallback-image-inline" alt="g" src="https://upload.wikimedia.org/x.svg"></span> rate.</p>' +
      '<p>Bare <math><mi>z</mi></math> end.</p>'
    expect(parse(wiki)).toEqual(doc(p(t('Growth '), im('{\\displaystyle g}'), t(' rate.')), p(t('Bare end.'))))
  })

  it('drops empty pasted equations', () => {
    expect(parse('<p>A<span data-type="inline-math" data-latex="  "></span>B</p>')).toEqual(doc(p(t('AB'))))
  })
})

describe('content safety checks', () => {
  it('reports node types the editor cannot open, so a document is never silently emptied', () => {
    const withoutMath = getSchema([StarterKit])
    const content = doc(p(t('x'), im('a')), bm('b'), { type: 'chartWidget' })
    expect(unsupportedContentTypes(content, withoutMath).sort()).toEqual(['blockMath', 'chartWidget', 'inlineMath'])
    const withMath = getSchema([StarterKit, ArticleInlineMath, ArticleBlockMath])
    expect(unsupportedContentTypes(doc(p(im('a')), bm('b')), withMath)).toEqual([])
  })

  it('finds equations that cannot be typeset, in reading order', () => {
    const content = JSON.stringify(doc(p(im('x')), p(im('\\frac{a')), bm('\\def\\a{b}')))
    const invalid = findInvalidEquations(content)
    expect(invalid.map((i) => i.number)).toEqual([2, 3])
    expect(invalidEquationsMessage(invalid)).toMatch(/^2 equations \(the first is equation 2\) cannot be typeset: A “\{” is missing/)
    expect(findInvalidEquations(JSON.stringify(doc(p(im('MR = MC')))))).toEqual([])
    expect(findInvalidEquations('not json')).toEqual([])
  })

  it('templates insert at the cursor, select the placeholder, and wrap a selection', () => {
    const fraction = MATH_TEMPLATE_GROUPS[0].templates.find((tpl) => tpl.label === 'Fraction')!
    expect(applyTemplate('y = ', 4, 4, fraction)).toEqual({ value: 'y = \\frac{a}{b}', selectionStart: 10, selectionEnd: 11 })
    const sqrt = MATH_TEMPLATE_GROUPS[0].templates.find((tpl) => tpl.label === 'Square root')!
    expect(applyTemplate('x+1', 0, 3, sqrt)).toEqual({ value: '\\sqrt{x+1}', selectionStart: 10, selectionEnd: 10 })
  })
})

describe('TiptapEditor with the equation dialog', () => {
  async function renderEditor(content?: string) {
    const { TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const onChange = vi.fn()
    render(<TiptapEditor content={content} onChange={onChange} />)
    const button = await screen.findByRole('button', { name: 'Insert or edit equation' })
    return { onChange, button }
  }
  const lastDoc = (onChange: ReturnType<typeof vi.fn>) => JSON.parse(onChange.mock.calls.at(-1)![0]) as Json

  it('inserts, edits, validates and deletes equations through the dialog', async () => {
    const { onChange, button } = await renderEditor(JSON.stringify(doc(p(t('Firms set ')))))
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Insert equation' })
    const textarea = screen.getByLabelText('LaTeX') as HTMLTextAreaElement
    expect(document.activeElement).toBe(textarea)
    expect((screen.getByRole('radio', { name: /Inline/ }) as HTMLInputElement).checked).toBe(true)
    const insert = screen.getByRole('button', { name: 'Insert equation' })
    expect((insert as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: 'MR = MC' } })
    await waitFor(() => expect(dialog.querySelector('[data-testid="math-dialog-preview"] .katex')).not.toBeNull())
    await waitFor(() => expect((insert as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(insert)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(lastDoc(onChange).content?.[0].content).toContainEqual(im('MR = MC'))

    // Click the equation to edit it; a malformed edit is refused with a clear message and the input kept.
    const equation = document.querySelector<HTMLElement>('.ProseMirror .tiptap-math')!
    fireEvent.click(equation)
    await screen.findByRole('dialog', { name: 'Edit equation' })
    const editBox = screen.getByLabelText('LaTeX') as HTMLTextAreaElement
    expect(editBox.value).toBe('MR = MC')
    fireEvent.change(editBox, { target: { value: '\\frac{MR' } })
    const update = screen.getByRole('button', { name: 'Update equation' })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('A “{” is missing its closing “}”.'))
    expect((update as HTMLButtonElement).disabled).toBe(true)
    expect(editBox.value).toBe('\\frac{MR')
    expect(editBox.getAttribute('aria-invalid')).toBe('true')

    // Fix it and switch to a display equation.
    fireEvent.change(editBox, { target: { value: '\\frac{MR}{MC} = 1' } })
    fireEvent.click(screen.getByRole('radio', { name: /Display/ }))
    await waitFor(() => expect((update as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(update)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(lastDoc(onChange).content?.some((n) => n.type === 'blockMath' && n.attrs?.latex === '\\frac{MR}{MC} = 1')).toBe(true)
    expect(JSON.stringify(lastDoc(onChange))).not.toContain('inlineMath')

    // Delete from the dialog.
    fireEvent.click(document.querySelector<HTMLElement>('.ProseMirror .tiptap-math')!)
    await screen.findByRole('dialog', { name: 'Edit equation' })
    fireEvent.click(screen.getByRole('button', { name: /Delete equation/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.stringify(lastDoc(onChange))).not.toMatch(/Math/)
  })

  it('leaves a text cursor after a display equation at the end of the article, so typing cannot replace it', async () => {
    const { onChange, button } = await renderEditor(JSON.stringify(doc({ type: 'paragraph' })))
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: 'Insert equation' })
    // An empty paragraph suggests a display equation.
    expect((screen.getByRole('radio', { name: /Display/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('LaTeX'), { target: { value: 'Y = C + I' } })
    const insert = screen.getByRole('button', { name: 'Insert equation' })
    await waitFor(() => expect((insert as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(insert)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const saved = lastDoc(onChange)
    expect(saved.content?.map((n) => n.type)).toEqual(['blockMath', 'paragraph'])
    expect(saved.content?.[0]).toEqual(bm('Y = C + I'))
    // Σ now starts a new equation rather than editing the one just inserted.
    fireEvent.click(button)
    expect(await screen.findByRole('dialog', { name: 'Insert equation' })).toBeTruthy()
  })

  it('cancels with Escape without changing the document, and templates fill the LaTeX box', async () => {
    const { onChange, button } = await renderEditor(JSON.stringify(doc(p(t('x')))))
    fireEvent.click(button)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Insert Fraction' }))
    expect((screen.getByLabelText('LaTeX') as HTMLTextAreaElement).value).toBe('\\frac{a}{b}')
    fireEvent.click(screen.getByRole('tab', { name: 'Greek' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert beta' }))
    expect((screen.getByLabelText('LaTeX') as HTMLTextAreaElement).value).toContain('\\beta')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('pauses editing instead of opening an empty document when content cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { TiptapEditor } = await import('@/components/editor/TiptapEditor')
    const onChange = vi.fn()
    render(<TiptapEditor content={JSON.stringify(doc(p(t('Keep me')), { type: 'futureWidget' }))} onChange={onChange} />)
    expect((await screen.findByRole('alert')).textContent).toContain('futureWidget')
    expect(screen.queryByRole('button', { name: 'Insert or edit equation' })).toBeNull()
    await act(async () => {})
    expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('opens existing articles with equations and plain articles exactly as before', async () => {
    const { onChange } = await renderEditor(JSON.stringify(doc(p(t('Plain article.')), bm('x'))))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('.ProseMirror .tiptap-math--display .katex')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
