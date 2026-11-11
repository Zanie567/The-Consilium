import katex, { type KatexOptions, type TrustContext } from 'katex'

/**
 * The one place that turns an equation's LaTeX into KaTeX output, shared by the
 * editor (live preview, publish check) and the server renderer for public pages,
 * so what an author previews is exactly what readers get.
 *
 * Safety (KaTeX docs, "Handling untrusted input"): trust is off, so \href, \url,
 * \includegraphics and the \html… commands can never emit links, images, ids,
 * classes or styles. They are reported as errors rather than silently shown as
 * red text. maxSize caps user-specified sizes (\rule, \kern) and maxExpand caps
 * macro expansion. Macro definitions (\def, \newcommand, …) are refused outright:
 * a short \def can expand into millions of tokens within the expansion limit,
 * and authors never need them. Input length and output size are both capped.
 */

/** Longest LaTeX source accepted for one equation. Typical equations are under 300 characters. */
export const MAX_LATEX_LENGTH = 3000

/** Rendered HTML larger than this is refused (a guard against pathological input). */
export const MAX_RENDERED_LENGTH = 400_000

const MACRO_DEFINITION =
  /\\(?:def|gdef|edef|xdef|let|futurelet|global|newcommand|renewcommand|providecommand)(?![a-zA-Z@])/

export type LatexResult =
  | { ok: true; html: string }
  | { ok: false; error: string }

function katexOptions(displayMode: boolean, blocked: string[]): KatexOptions {
  return {
    displayMode,
    // MathML for screen readers alongside the visual HTML.
    output: 'htmlAndMathml',
    throwOnError: true,
    // Every trust request is refused and recorded so the author is told.
    trust: (context: TrustContext) => {
      blocked.push(context.command)
      return false
    },
    // Non-standard LaTeX that KaTeX can still typeset is accepted without console noise.
    strict: 'ignore',
    maxSize: 20,
    maxExpand: 1000,
    // A fresh macro table per render: nothing one equation does can affect another.
    macros: {},
    globalGroup: false,
  }
}

function friendlyParseError(raw: string): string {
  const message = raw.replace(/^KaTeX parse error:\s*/, '').trim()
  const undefinedCommand = message.match(/^Undefined control sequence: (\\[^\s]+)/)
  if (undefinedCommand) {
    return `“${undefinedCommand[1]}” is not a recognised command. Check the spelling, or use a template.`
  }
  if (/Expected '\}', got 'EOF'|end of input in a macro argument, expected '\}'/.test(message)) return 'A “{” is missing its closing “}”.'
  if (/Expected 'EOF', got '\}'|Extra \}/.test(message)) return 'There is a “}” without a matching “{”.'
  if (/got '&'/.test(message)) {
    return '“&” separates columns, so it only works inside a matrix or aligned block. To show an ampersand, type \\&.'
  }
  if (/Expected '\\right'/.test(message)) return 'Each \\left needs a matching \\right.'
  if (/Double superscript/.test(message)) return 'Two superscripts in a row: group them in braces, e.g. x^{2a}.'
  if (/Double subscript/.test(message)) return 'Two subscripts in a row: group them in braces, e.g. x_{ij}.'
  if (/only in display mode|works only in display/.test(message)) {
    return 'This needs a display equation. Switch the equation type to “Display”.'
  }
  if (/Too many expansions/.test(message)) return 'This equation is too complex to typeset.'
  if (/Invalid color/.test(message)) return 'That colour is not recognised. Use a colour name or a hex code such as #1a2744.'
  return message.charAt(0).toUpperCase() + message.slice(1)
}

/** Checks that need no rendering. Returns an error message, or null when the input may be rendered. */
export function latexInputError(latex: string): string | null {
  if (!latex.trim()) return 'Enter an equation.'
  if (latex.length > MAX_LATEX_LENGTH) {
    return `This equation is too long (${latex.length.toLocaleString('en-GB')} characters; the limit is ${MAX_LATEX_LENGTH.toLocaleString('en-GB')}). Split it into several equations.`
  }
  const macro = latex.match(MACRO_DEFINITION)
  if (macro) return `Custom definitions (${macro[0]}) are not supported. Write the expression out in full.`
  return null
}

type Typeset<T> = (options: KatexOptions) => T

/** Input checks, the KaTeX call and error mapping, shared by both outputs below. */
function typeset<T>(latex: string, displayMode: boolean, run: Typeset<T>): { ok: true; value: T } | { ok: false; error: string } {
  const inputError = latexInputError(latex)
  if (inputError) return { ok: false, error: inputError }
  const blocked: string[] = []
  let value: T
  try {
    value = run(katexOptions(displayMode, blocked))
  } catch (error) {
    if (error instanceof katex.ParseError) return { ok: false, error: friendlyParseError(error.rawMessage ?? error.message) }
    return { ok: false, error: 'This equation is too complex to typeset.' }
  }
  if (blocked.length > 0) {
    return { ok: false, error: `${blocked[0]} cannot be used in equations (links, images and HTML commands are not allowed).` }
  }
  return { ok: true, value }
}

/**
 * Renders LaTeX to an HTML string with the safe options above (server and
 * dialog preview). Never throws: any failure, including deep-recursion errors
 * from pathological input, comes back as `{ ok: false }`.
 */
export function renderLatex(latex: string, displayMode: boolean): LatexResult {
  const result = typeset(latex, displayMode, (options) => katex.renderToString(latex, options))
  if (!result.ok) return result
  if (result.value.length > MAX_RENDERED_LENGTH) return { ok: false, error: 'This equation is too large to typeset.' }
  return { ok: true, html: result.value }
}

/**
 * Same as renderLatex, but KaTeX builds the DOM directly inside `element`
 * (editor node views), so no HTML string is ever parsed. On failure the element
 * is left empty and the error returned.
 */
export function renderLatexInto(element: HTMLElement, latex: string, displayMode: boolean): { ok: true } | { ok: false; error: string } {
  const result = typeset(latex, displayMode, (options) => katex.render(latex, element, options))
  if (!result.ok || element.innerHTML.length > MAX_RENDERED_LENGTH) {
    element.replaceChildren()
    return result.ok ? { ok: false, error: 'This equation is too large to typeset.' } : result
  }
  return { ok: true }
}
