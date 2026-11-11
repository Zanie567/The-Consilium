# Equations in articles

The article editor can insert professionally typeset mathematical equations. You do not need to
know LaTeX: the equation editor has buttons for every common structure, symbol and economics
formula. Authors who do know LaTeX can type or paste it directly.

## Inserting an equation

1. Put the cursor where the equation should go.
2. Press the **Σ** button in the toolbar (it sits after the footnote button).
3. Choose the **equation type**: **Inline** or **Display** (see below).
4. Build the equation:
   - Use the buttons under **Structures**, **Greek**, **Relations** and **Economics**. Each button
     adds that piece at the cursor in the LaTeX box and selects the placeholder (for example the
     `a` in a fraction) so you can type over it straight away.
   - If you select some text in the LaTeX box first, a structure button wraps it. Select `x+1` and
     press **Square root** to get `\sqrt{x+1}`.
   - Or type or paste LaTeX into the box.
5. Check the **Preview**. It shows exactly what readers will see.
6. Press **Insert equation**, or **Ctrl+Enter** (**⌘+Enter** on a Mac).

**Escape** or **Cancel** closes the editor without changing the article.

If text is selected in the article when you press Σ, it becomes the starting LaTeX, and the new
equation replaces it.

## Inline or display?

| | Inline | Display |
|---|---|---|
| Where it appears | Inside a sentence, on the text line | On its own line, centred, with space above and below |
| Use it for | Short expressions you refer to in the prose: *profit is maximised where MR = MC* | Important, long or multi-line equations: identities, models, regressions, matrices |
| Size | Compact (fractions and sums are kept small) | Full size |

Rule of thumb: if the equation would be numbered or discussed on its own in a journal, make it a
display equation.

Pressing Σ on an empty line suggests **Display**; inside a sentence it suggests **Inline**. You can
switch either way before inserting, and later when editing.

## Editing, moving and deleting

- **Edit**: click the equation, or move onto it with the arrow keys and press **Enter**. Change the
  LaTeX or the type, then press **Update equation**.
- **Delete**: open it and press **Delete equation**, or select it and press Backspace.
- **Undo / redo** work for inserting, editing and deleting equations, as for any other change.
- **Copy and paste** equations within an article or between articles as usual. Equations copied
  from a published Consilium article, or from pages that publish their LaTeX source (such as
  Wikipedia), are pasted back as editable equations.

Equations are saved with the draft (including autosave) as their LaTeX source, so they can always
be edited again after reopening the article, during review, or in later revisions.

## When an equation cannot be typeset

The preview tells you what is wrong in plain language, for example *A “{” is missing its closing
“}”*, and the Insert button stays disabled. Your input is never cleared: fix it and the preview
updates as you type.

An equation that cannot be typeset (for example one pasted from elsewhere) appears in the article
as its LaTeX source in a dashed red box. Click it to fix it. You can still save the draft, but the
article cannot be **submitted**, **scheduled** or **published** until every equation is fixed. The
message names the equation by its position in the article (equation 1, 2, 3…).

What is not allowed, by design:

- Links, images and HTML commands (`\href`, `\url`, `\includegraphics`, `\htmlClass` and similar).
- Defining your own commands (`\def`, `\newcommand`, `\let`). Write the expression out in full.
- Equations longer than 3,000 characters. Split them into several equations.

## Ready-to-use examples

Copy any of these into the LaTeX box. Most are also available as buttons under **Economics**.

| Equation | LaTeX | Suggested type |
|---|---|---|
| Profit maximisation | `MR = MC` | Inline |
| National income identity | `Y = C + I + G + (X - M)` | Display |
| Linear regression | `Y_i = \beta_0 + \beta_1 X_i + \varepsilon_i` | Display |
| OLS estimator | `\hat{\beta} = (X^{\top}X)^{-1}X^{\top}y` | Display |
| Summation | `\sum_{i=1}^{n} x_i` | Either |
| Marginal utility | `\frac{\partial U}{\partial x}` | Either |
| Present value | `PV = \sum_{t=1}^{T} \frac{CF_t}{(1+r)^t}` | Display |
| Cobb–Douglas | `Y = A K^{\alpha} L^{1-\alpha}` | Display |
| Conditional expectation | `\mathbb{E}[Y \mid X]` | Inline |
| Fisher equation | `1 + i = (1 + r)(1 + \pi^{e})` | Display |
| Inequality | `0 \le \alpha < 1` | Inline |
| 2 × 2 matrix | `\begin{bmatrix} a & b \\ c & d \end{bmatrix}` | Display |
| Piecewise | `f(x) = \begin{cases} 1 & x > 0 \\ 0 & \text{otherwise} \end{cases}` | Display |

Small LaTeX reminders: `_` is a subscript and `^` a superscript; group more than one character
in braces (`x_{t-1}`, `e^{rt}`). Use `\text{…}` for words inside an equation. Use `\%` for a
percent sign and `\$` for a dollar sign inside an equation.

## Dollar signs in your text

Ordinary dollar amounts are never turned into maths. Typing `$5 and $10` (or even `$$`) in a
paragraph stays plain text. Equations are only ever created with the Σ button or by pasting an
equation.

## On the published page

Equations are typeset on the server, so they appear instantly, are sharp at any zoom level, follow
the light and dark themes, and print cleanly. A wide display equation scrolls sideways inside its
own box on a phone rather than widening the page. Screen readers read the equation itself
(MathML), not the LaTeX source. Equations do not count towards the word count or reading time.

---

## For maintainers

### Storage

Equations use the official `@tiptap/extension-mathematics` nodes, stored in `Article.content`
(Tiptap JSON). No database migration.

```json
{ "type": "inlineMath", "attrs": { "latex": "MR = MC" } }
{ "type": "blockMath",  "attrs": { "latex": "Y = C + I + G + (X - M)" } }
```

`inlineMath` is an inline atom inside paragraphs, headings, list items and table cells;
`blockMath` is a block atom between blocks.

### Editor-to-publication path

| Stage | Code |
|---|---|
| Shared typesetting, limits, safe KaTeX options, error messages | `src/lib/math/latex.ts` |
| Editor nodes (no `$` input rules), node views, click / Enter to edit | `src/components/editor/extensions/ArticleMath.ts` |
| Σ dialog and templates | `src/components/editor/MathEquationDialog.tsx`, `src/lib/math/templates.ts` |
| Paste (editor clipboard, KaTeX/MathJax/Wikipedia MathML) | `src/lib/editor/cleanPastedHTML.ts` |
| Submit / publish guard | `src/lib/math/contentEquations.ts` (editor controller, review panel) |
| Unknown-node guard (never open a blank document that autosave could save) | `src/lib/editor/unsupportedContent.ts` |
| Public rendering | `src/lib/articleRender.ts` → `src/lib/math/articleMath.ts` |
| KaTeX output allowlist | `src/lib/math/katexSanitize.ts` |
| Glossary links skip equations | `src/lib/glossary/linkify.ts` |
| Corrections diff shows `[equation: …]` | `src/lib/corrections/diff.ts` |
| Styles (article, editor, dialog, print) | `src/app/globals.css`, "Equations (KaTeX)" |

### Security model

KaTeX output needs inline `style` attributes and MathML, which the article sanitiser
(`ARTICLE_SANITIZE_OPTIONS`) deliberately refuses. That sanitiser is **unchanged**. Instead:

1. The renderer emits a placeholder for each equation: `mathslot<random per-render nonce>n<i>x`,
   plain text that stored content cannot forge.
2. The article HTML is sanitised exactly as before.
3. Each placeholder is replaced with KaTeX output for that equation. KaTeX runs with
   `trust` off (and every trust request is reported as an error), `maxSize: 20`,
   `maxExpand: 1000`, a fresh macro table per equation, macro definitions refused, a
   3,000-character input limit and a 400 KB output limit. The output is then checked
   against a KaTeX-only allowlist (`katexSanitize.ts`): no URL attributes at all, style
   values restricted to lengths, keywords and colours, SVG limited to `svg`, `path` and
   `line`.

Malformed or refused LaTeX renders as escaped source in `<code>`, so a page never fails.
`tests/unit/math-render.test.ts` checks that real KaTeX output for a broad corpus passes the
allowlist unchanged: after a KaTeX upgrade, run it before deploying.

### Performance

Public pages ship KaTeX's CSS (about 23 KB, 6 KB gzipped) and load its fonts only when an
equation uses them. No KaTeX JavaScript reaches readers. Typesetting runs on the server only
when a page is (re)generated, and results are memoised per instance (500 entries). The editor
bundles KaTeX JavaScript, which already loads only in the editorial portal.

### Tests

- `tests/unit/math-render.test.ts`: renderer, allowlist, XSS, limits, glossary, word count, diff.
- `tests/unit/math-editor.test.tsx`: nodes, commands, undo/redo, reload, paste, dialog, guards.
- `tests/e2e/wf-equations.spec.ts`: write, save, reload, submit guard, review, publish, public
  page (MathML, alignment, fonts, no KaTeX JS), dark theme, phone overflow, print, hostile content.
