import sanitizeHtml from 'sanitize-html'

/**
 * Allowlist for KaTeX's own output, applied as defence in depth before that
 * output is placed in a public article.
 *
 * Article HTML goes through ARTICLE_SANITIZE_OPTIONS (src/lib/articleSanitize.ts),
 * which deliberately allows no `style` attribute and no MathML. KaTeX needs both:
 * inline styles carry its vertical metrics, and MathML is what screen readers
 * read. Rather than relaxing the article sanitiser for everyone, KaTeX output is
 * produced separately (src/lib/math/articleMath.ts), checked here against a list
 * of exactly the elements, attributes and style properties KaTeX emits, and only
 * then substituted into the already-sanitised article.
 *
 * Nothing here can produce a link, image, script, event handler or url(): there
 * is no href/src attribute at all, style values must be plain lengths, keywords
 * or colours, and SVG is limited to <svg>, <path> and <line> with geometry only.
 * tests/unit/math-render.test.ts checks that real KaTeX output for a broad corpus
 * passes through unchanged, so a KaTeX upgrade that emits something new fails
 * that test instead of silently losing markup.
 */

const LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt|%)?$/
const LENGTH_LIST = /^(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt|%)?\s*){1,4}$/
// KaTeX accepts colour names and hex codes only (it rejects rgb(), url(), ';', etc.).
const COLOUR = /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i
const BORDER = /^(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt)?\s+)?(?:solid|dashed|dotted|none)(?:\s+(?:#[0-9a-f]{3,8}|[a-z]+))?$/i

const KATEX_STYLES: Record<string, RegExp[]> = {
  height: [LENGTH],
  width: [LENGTH],
  'min-width': [LENGTH],
  'max-width': [LENGTH],
  'vertical-align': [LENGTH],
  top: [LENGTH],
  bottom: [LENGTH],
  left: [LENGTH],
  right: [LENGTH],
  margin: [LENGTH_LIST],
  'margin-left': [LENGTH],
  'margin-right': [LENGTH],
  'margin-top': [LENGTH],
  'margin-bottom': [LENGTH],
  'padding-left': [LENGTH],
  'padding-right': [LENGTH],
  'padding-top': [LENGTH],
  'padding-bottom': [LENGTH],
  padding: [LENGTH_LIST],
  'border-width': [LENGTH_LIST],
  'border-top-width': [LENGTH],
  'border-bottom-width': [LENGTH],
  'border-right-width': [LENGTH],
  'border-left-width': [LENGTH],
  'border-style': [/^(?:solid|dashed|dotted|none)$/],
  'border-right-style': [/^(?:solid|dashed|dotted|none)$/],
  'border-color': [COLOUR],
  border: [BORDER],
  'border-bottom': [BORDER],
  'border-top': [BORDER],
  position: [/^(?:relative|absolute)$/],
  color: [COLOUR],
  'background-color': [COLOUR],
}

const MATHML_PRESENTATION = ['mathvariant', 'mathcolor', 'mathbackground', 'mathsize']

export const KATEX_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'span',
    'math', 'semantics', 'annotation',
    'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mpadded', 'mphantom', 'mstyle', 'menclose',
    'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
    'mfrac', 'msqrt', 'mroot',
    'mtable', 'mtr', 'mtd', 'mlabeledtr',
    'svg', 'path', 'line',
  ],
  allowedAttributes: {
    span: ['class', 'style', 'aria-hidden'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    mrow: MATHML_PRESENTATION,
    mi: MATHML_PRESENTATION,
    mn: MATHML_PRESENTATION,
    ms: MATHML_PRESENTATION,
    mtext: MATHML_PRESENTATION,
    mo: [...MATHML_PRESENTATION, 'stretchy', 'fence', 'separator', 'minsize', 'maxsize', 'lspace', 'rspace', 'movablelimits', 'largeop', 'symmetric', 'form'],
    mspace: ['width', 'height', 'depth', 'linebreak', 'mathbackground'],
    mpadded: ['width', 'height', 'depth', 'lspace', 'voffset', 'class', 'style', 'mathbackground'],
    mstyle: [...MATHML_PRESENTATION, 'scriptlevel', 'displaystyle'],
    menclose: ['notation', 'mathbackground'],
    munder: ['accentunder'],
    mover: ['accent'],
    munderover: ['accent', 'accentunder'],
    mfrac: ['linethickness'],
    mtable: ['rowspacing', 'columnalign', 'columnspacing', 'width', 'columnlines', 'rowlines', 'frame', 'framespacing', 'side', 'displaystyle'],
    mtr: ['columnalign'],
    mtd: ['width', 'class', 'columnalign', 'style'],
    mlabeledtr: [],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style'],
    path: ['d'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke-width'],
  },
  allowedStyles: {
    span: KATEX_STYLES,
    svg: KATEX_STYLES,
    mpadded: KATEX_STYLES,
    mtd: KATEX_STYLES,
  },
  // No URL-bearing attribute is allowed at all; this is belt and braces.
  allowedSchemes: [],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // SVG attributes are case-sensitive (viewBox, preserveAspectRatio).
  parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
}

export function sanitizeKatexHtml(html: string): string {
  return sanitizeHtml(html, KATEX_SANITIZE_OPTIONS)
}
