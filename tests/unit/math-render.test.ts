import { describe, it, expect } from 'vitest'
import { Parser } from 'htmlparser2'
import { renderContent, type TiptapNode } from '@/lib/articleRender'
import { renderLatex, latexInputError, MAX_LATEX_LENGTH } from '@/lib/math/latex'
import { sanitizeKatexHtml } from '@/lib/math/katexSanitize'
import { renderArticleMath } from '@/lib/math/articleMath'
import { buildGlossaryMatcher, linkifyGlossaryTerms } from '@/lib/glossary/linkify'
import { wordCountFromContent } from '@/lib/readTime'
import { passagesOf } from '@/lib/corrections/diff'
import { ECONOMICS_EQUATIONS, KATEX_FEATURE_CORPUS } from '../fixtures/mathCorpus'

/**
 * Equations from stored Tiptap JSON to public HTML. renderContent is the exact
 * function the public article page and the corrections preview use, so these
 * tests cover the real placeholder, sanitiser and KaTeX path.
 */

const inline = (latex: unknown): TiptapNode => ({ type: 'inlineMath', attrs: { latex } as TiptapNode['attrs'] })
const block = (latex: unknown): TiptapNode => ({ type: 'blockMath', attrs: { latex } as TiptapNode['attrs'] })
const text = (value: string): TiptapNode => ({ type: 'text', text: value })
const para = (...children: (TiptapNode | string)[]): TiptapNode => ({
  type: 'paragraph',
  content: children.map((c) => (typeof c === 'string' ? text(c) : c)),
})
const doc = (...content: TiptapNode[]) => JSON.stringify({ type: 'doc', content })

/** Tags, attributes (style declarations normalised) and decoded text, in document order. */
function tokens(html: string): string[] {
  const out: string[] = []
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const normalised = Object.entries(attrs)
          .map(([k, v]) => [k, k === 'style' ? v.split(';').map((d) => d.replace(/\s*:\s*/, ':').trim()).filter(Boolean).join(';') : v])
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => `${k}=${v}`)
        out.push(`<${name} ${normalised.join(' ')}>`)
      },
      ontext(value) {
        if (value) out.push(value)
      },
      onclosetag(name) {
        out.push(`</${name}>`)
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: false, recognizeSelfClosing: true },
  )
  parser.write(html)
  parser.end()
  // Adjacent text events are an artefact of entity decoding; join them.
  return out.reduce<string[]>((acc, t) => {
    const last = acc[acc.length - 1]
    if (last !== undefined && !t.startsWith('<') && !last.startsWith('<')) acc[acc.length - 1] = last + t
    else acc.push(t)
    return acc
  }, [])
}

describe('renderLatex (shared by editor preview and server)', () => {
  it('typesets every representative economics equation in its intended mode', () => {
    for (const eq of ECONOMICS_EQUATIONS) {
      const result = renderLatex(eq.latex, eq.display)
      expect(result, eq.name).toMatchObject({ ok: true })
    }
  })

  it('reports malformed LaTeX with a plain-language message', () => {
    expect(renderLatex('\\frac{a', false)).toEqual({ ok: false, error: 'A “{” is missing its closing “}”.' })
    expect(renderLatex('a}', false)).toEqual({ ok: false, error: 'There is a “}” without a matching “{”.' })
    expect(renderLatex('\\fracc{a}{b}', false)).toMatchObject({ ok: false, error: expect.stringContaining('“\\fracc” is not a recognised command') })
    expect(renderLatex('x^2^3', false)).toMatchObject({ ok: false, error: expect.stringContaining('Two superscripts') })
    expect(renderLatex('a & b', false)).toMatchObject({ ok: false, error: expect.stringContaining('\\&') })
    expect(renderLatex('\\left( x', false)).toMatchObject({ ok: false, error: expect.stringContaining('\\right') })
    expect(renderLatex('\\begin{align} a &= b \\end{align}', false)).toMatchObject({ ok: false, error: expect.stringContaining('Display') })
    expect(renderLatex('   ', true)).toEqual({ ok: false, error: 'Enter an equation.' })
  })

  it('refuses links, images and HTML commands instead of showing them as text', () => {
    for (const latex of [
      '\\href{javascript:alert(1)}{x}',
      '\\url{https://example.com}',
      '\\includegraphics{https://example.com/x.png}',
      '\\htmlClass{glossary-term}{x}',
      '\\htmlStyle{background:url(x)}{x}',
      '\\htmlId{fnref-1}{x}',
      '\\htmlData{footnote=x}{x}',
    ]) {
      const result = renderLatex(latex, false)
      expect(result, latex).toMatchObject({ ok: false, error: expect.stringContaining('cannot be used in equations') })
    }
  })

  it('refuses macro definitions, which could expand into enormous output', () => {
    for (const latex of ['\\def\\a{x}\\a', '\\gdef\\b{y}', '\\newcommand{\\c}{z}', '\\renewcommand{\\d}{z}', '\\let\\e=x', '\\global\\def\\f{x}']) {
      expect(renderLatex(latex, false), latex).toMatchObject({ ok: false, error: expect.stringContaining('Custom definitions') })
    }
    // A command that merely starts with "def" is not a definition.
    expect(latexInputError('\\deg x')).toBeNull()
  })

  it('caps input length and survives pathological input quickly', () => {
    const tooLong = 'x+'.repeat(MAX_LATEX_LENGTH)
    expect(renderLatex(tooLong, false)).toMatchObject({ ok: false, error: expect.stringContaining('too long') })

    const started = Date.now()
    const pathological = [
      '{'.repeat(1400) + 'x' + '}'.repeat(1400),
      '\\sqrt{'.repeat(400) + 'x' + '}'.repeat(400),
      '\\frac{'.repeat(250) + '1}{2}'.repeat(250),
      'x^{'.repeat(700) + 'y' + '}'.repeat(700),
      '\\left('.repeat(200) + 'x' + '\\right)'.repeat(200),
      '\\begin{bmatrix}' + Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => 'a').join('&')).join('\\\\') + '\\end{bmatrix}',
      '\\rule{100000em}{100000em}',
      '\\kern{-100000em} x',
      '\\Huge'.repeat(500),
    ]
    for (const latex of pathological) {
      expect(latex.length).toBeLessThanOrEqual(MAX_LATEX_LENGTH)
      // Must return (either result) without throwing.
      const result = renderLatex(latex, true)
      expect(typeof result.ok).toBe('boolean')
    }
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('caps user-specified sizes (maxSize)', () => {
    const result = renderLatex('\\rule{100000em}{1em}', false)
    expect(result.ok).toBe(true)
    // The source stays in the MathML annotation; the visual HTML is clamped to 20em.
    if (result.ok) {
      const visual = result.html.slice(result.html.indexOf('katex-html'))
      expect(visual).not.toMatch(/100000/)
      expect(visual).toMatch(/border-right-width:20em/)
    }
  })

  it('keeps each render isolated: a definition in one equation cannot leak into another', () => {
    renderLatex('\\gdef\\leak{LEAKED}', false)
    expect(renderLatex('\\leak', false)).toMatchObject({ ok: false })
  })
})

describe('KaTeX output allowlist', () => {
  it('passes real KaTeX output through unchanged for the whole corpus (tags, attributes, text)', () => {
    const corpus = [...ECONOMICS_EQUATIONS.map((e) => e.latex), ...KATEX_FEATURE_CORPUS]
    let checked = 0
    for (const latex of corpus) {
      for (const display of [false, true]) {
        const result = renderLatex(latex, display)
        if (!result.ok) continue
        checked++
        expect(tokens(sanitizeKatexHtml(result.html)), `${latex} (${display ? 'display' : 'inline'})`).toEqual(tokens(result.html))
      }
    }
    expect(checked).toBeGreaterThan(60)
  })

  it('strips anything KaTeX never produces', () => {
    const hostile =
      '<span class="katex" onclick="alert(1)" style="background:url(javascript:alert(1));height:1em;color:red;position:fixed">' +
      '<a href="javascript:alert(1)">x</a><img src=x onerror="alert(1)"><script>alert(1)</script>' +
      '<svg onload="alert(1)"><foreignObject><div>x</div></foreignObject><use href="#a"/><path d="M0 0" onclick="x"/></svg>' +
      '<math><mi xlink:href="javascript:alert(1)" href="javascript:alert(1)">y</mi><maction actiontype="statusline">z</maction></math>' +
      '<style>body{display:none}</style></span>'
    const clean = sanitizeKatexHtml(hostile)
    expect(clean).not.toMatch(/onclick|onerror|onload|javascript:|url\(|<a\b|<img|<script|<style|foreignObject|<use|<maction|href|position:fixed/i)
    expect(clean).toContain('height:1em')
    expect(clean).toContain('color:red')
    expect(clean).toContain('<path d="M0 0">')
  })
})

describe('equations in published articles', () => {
  it('renders an inline equation inside its paragraph, with MathML and hidden visual HTML', () => {
    const { html } = renderContent(doc(para('Firms produce where ', inline('MR = MC'), ' in equilibrium.')))
    expect(html).toMatch(/^<p>Firms produce where <span class="math-inline"><span class="katex">/)
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">')
    expect(html).toContain('<annotation encoding="application/x-tex">MR = MC</annotation>')
    expect(html).toContain('<span class="katex-html" aria-hidden="true">')
    expect(html).toMatch(/<\/span><\/span> in equilibrium\.<\/p>$/)
    expect(html).not.toContain('mathslot')
  })

  it('renders a display equation as its own block between paragraphs', () => {
    const { html } = renderContent(doc(para('Output is'), block('Y = C + I + G + (X - M)'), para('by definition.')))
    expect(html).toMatch(/^<p>Output is<\/p><div class="math-display"><span class="katex-display"><span class="katex">/)
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">')
    expect(html).toMatch(/<\/div><p>by definition\.<\/p>$/)
  })

  it('renders matrices, regressions and partial derivatives', () => {
    const { html } = renderContent(
      doc(
        block('\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}'),
        block('Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i'),
        block('\\frac{\\partial U}{\\partial x}'),
        block('\\sum_{i=1}^{n} x_i'),
      ),
    )
    expect(html.match(/class="math-display"/g)).toHaveLength(4)
    expect(html).toContain('<mtable')
    expect(html).toContain('<mi>β</mi>')
    expect(html).toContain('<mi mathvariant="normal">∂</mi>')
    expect(html).toContain('<mo>∑</mo>')
    expect(html).not.toContain('math-error')
  })

  it('shows malformed LaTeX as escaped source instead of failing, and keeps the rest of the article', () => {
    const { html } = renderContent(doc(para('Before ', inline('\\frac{a'), ' after.'), block('<b>\\undefinedthing</b>'), para('End.')))
    expect(html).toContain('<p>Before <span class="math-inline math-error"><code>\\frac{a</code></span> after.</p>')
    expect(html).toContain('<div class="math-display math-error"><code>&lt;b&gt;\\undefinedthing&lt;/b&gt;</code></div>')
    expect(html).toContain('<p>End.</p>')
  })

  it('drops empty or non-string equations without breaking the page', () => {
    const { html } = renderContent(doc(para('A', inline(''), 'B', inline({ evil: '<script>' }), inline(null)), block('   '), block(42)))
    expect(html).toBe('<p>AB</p>')
  })

  it('cannot be used to inject markup (XSS)', () => {
    const attempts = [
      '\\text{<img src=x onerror=alert(1)>}',
      '</span><script>alert(1)</script>',
      '\\href{javascript:alert(1)}{click}',
      '\\url{javascript:alert(1)}',
      '\\htmlClass{x" onclick="alert(1)}{y}',
      '\\text{"><svg onload=alert(1)>}',
      "x' onmouseover='alert(1)",
      '\\verb|<iframe src=javascript:alert(1)>|',
    ]
    const { html } = renderContent(doc(...attempts.map((a) => para(inline(a))), ...attempts.map((a) => block(a))))
    // Attack strings may appear as escaped text (that is what readers should see);
    // what must never appear is a dangerous element or attribute.
    const elements: string[] = []
    const attributes: string[] = []
    const parser = new Parser({
      onopentag(name, attrs) {
        elements.push(name)
        attributes.push(...Object.keys(attrs))
        for (const value of Object.values(attrs)) expect(value).not.toMatch(/javascript:|url\(/i)
      },
    })
    parser.write(html)
    parser.end()
    expect(elements.filter((e) => ['script', 'img', 'iframe', 'a', 'object', 'embed', 'foreignobject', 'style'].includes(e))).toEqual([])
    expect(attributes.filter((a) => /^on|^href$|^src$|^xlink/i.test(a))).toEqual([])
    expect(html).toContain('&lt;iframe src=javascript:alert(1)&gt;')
  })

  it('placeholders cannot be forged from article text', () => {
    // Even a guessed placeholder shape in ordinary text stays text: the real
    // token contains a fresh random nonce on every render.
    const forged = 'mathslot00000000000000000000000000000000n0x'
    const { html } = renderContent(doc(para(forged, inline('x')), para('mathslotn0x')))
    expect(html).toContain(`<p>${forged}<span class="math-inline">`)
    expect(html).toContain('<p>mathslotn0x</p>')
  })

  it('leaves ordinary dollar amounts alone', () => {
    const { html } = renderContent(doc(para('Prices rose from $5 to $10, then $$20$$ and $x$.')))
    expect(html).toBe('<p>Prices rose from $5 to $10, then $$20$$ and $x$.</p>')
  })

  it('preserves existing content: footnotes, tables, figures, links and headings around equations', () => {
    const { html, footnotes } = renderContent(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Model '), inline('\\alpha')] },
        para(text('See '), { type: 'text', text: 'the data', marks: [{ type: 'link', attrs: { href: 'https://ons.gov.uk' } }] }, inline('r > g'), { type: 'footnoteRef', attrs: { index: 7, content: 'Piketty (2014).' } }),
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(inline('\\pi_t'))] }, { type: 'tableCell', content: [block('\\bar{y}')] }] }],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [para('Item ', inline('i'))] }] },
        { type: 'figure', attrs: { src: 'https://images.unsplash.com/x.jpg', alt: 'Chart', caption: 'Figure 1' } },
      ),
    )
    expect(html).toMatch(/^<h2>Model <span class="math-inline">/)
    expect(html).toContain('<a href="https://ons.gov.uk" target="_self" rel="noopener">the data</a><span class="math-inline">')
    expect(html).toContain('id="fnref-1"')
    expect(footnotes).toEqual([{ index: 1, content: 'Piketty (2014).' }])
    expect(html).toMatch(/<td><p><span class="math-inline">.*<\/p><\/td><td><div class="math-display">/)
    expect(html).toMatch(/<li><p>Item <span class="math-inline">/)
    expect(html).toContain('<figure')
    expect(html).not.toContain('mathslot')
  })

  it('memoises typesetting: the same equation renders identically', () => {
    expect(renderArticleMath('E = mc^2', false)).toBe(renderArticleMath('E = mc^2', false))
    expect(renderArticleMath('E = mc^2', true)).not.toBe(renderArticleMath('E = mc^2', false))
  })

  it('keeps accessibility markup through glossary linking, which never links inside equations', () => {
    const { html } = renderContent(doc(para('Real GDP grows: ', inline('\\text{GDP}_t = (1+g)\\,\\text{GDP}_{t-1}'), '. Inflation and GDP.'), block('\\text{Inflation} = \\pi_t')))
    const matcher = buildGlossaryMatcher([
      { id: '1', term: 'GDP', aliases: [], definition: 'Gross domestic product.', learnMoreUrl: null },
      { id: '2', term: 'Inflation', aliases: [], definition: 'Rising prices.', learnMoreUrl: null },
    ])
    const linked = linkifyGlossaryTerms(html, matcher)
    // The first prose occurrences are linked, the maths is untouched.
    expect(linked).toContain('Real <span class="glossary-term" data-gloss-term="GDP"')
    expect(linked).toContain('. <span class="glossary-term" data-gloss-term="Inflation"')
    const mathParts = linked.match(/<span class="math-inline">[\s\S]*?<\/annotation>|<div class="math-display">[\s\S]*?<\/annotation>/g) ?? []
    expect(mathParts).toHaveLength(2)
    for (const part of mathParts) expect(part).not.toContain('glossary-term')
    expect(linked).toContain('<annotation encoding="application/x-tex">\\text{Inflation} = \\pi_t</annotation>')
    expect(linked.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('other consumers of article content', () => {
  const content = doc(para('Profit is maximised where ', inline('MR = MC'), '.'), block('\\sum_{i=1}^{n} \\frac{CF_i}{(1+r)^i}'))

  it('word counts and reading time ignore LaTeX source', () => {
    expect(wordCountFromContent(content)).toBe(5)
  })

  it('corrections diff shows equations as their LaTeX, so a changed formula is visible', () => {
    expect(passagesOf(content)).toEqual([
      'Profit is maximised where [equation: MR = MC].',
      '[equation: \\sum_{i=1}^{n} \\frac{CF_i}{(1+r)^i}]',
    ])
  })
})
