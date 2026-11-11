/**
 * Insertion templates for the equation dialog, so authors can build formulas
 * without knowing LaTeX. Each template is `before + placeholder + after`; the
 * placeholder is selected after insertion so the author can type over it, and if
 * text is already selected in the LaTeX box it takes the placeholder's place
 * (select "x+1", press Square root, get \sqrt{x+1}).
 */

export interface MathTemplate {
  /** Accessible name and tooltip, in plain English. */
  label: string
  /** LaTeX shown on the button (rendered by KaTeX). */
  preview: string
  before: string
  placeholder?: string
  after?: string
}

export interface MathTemplateGroup {
  id: string
  label: string
  templates: MathTemplate[]
}

const symbol = (label: string, latex: string): MathTemplate => ({ label, preview: latex, before: `${latex} ` })

export const MATH_TEMPLATE_GROUPS: MathTemplateGroup[] = [
  {
    id: 'structures',
    label: 'Structures',
    templates: [
      { label: 'Fraction', preview: '\\frac{a}{b}', before: '\\frac{', placeholder: 'a', after: '}{b}' },
      { label: 'Exponent (superscript)', preview: 'x^{n}', before: '', placeholder: 'x', after: '^{n}' },
      { label: 'Subscript', preview: 'x_{i}', before: '', placeholder: 'x', after: '_{i}' },
      { label: 'Square root', preview: '\\sqrt{x}', before: '\\sqrt{', placeholder: 'x', after: '}' },
      { label: 'nth root', preview: '\\sqrt[n]{x}', before: '\\sqrt[n]{', placeholder: 'x', after: '}' },
      { label: 'Summation', preview: '\\sum_{i=1}^{n}', before: '\\sum_{i=1}^{n} ', placeholder: 'x_i' },
      { label: 'Product', preview: '\\prod_{i=1}^{n}', before: '\\prod_{i=1}^{n} ', placeholder: 'x_i' },
      { label: 'Integral', preview: '\\int_{a}^{b}', before: '\\int_{a}^{b} ', placeholder: 'f(x)', after: ' \\, dx' },
      { label: 'Limit', preview: '\\lim_{x \\to \\infty}', before: '\\lim_{x \\to \\infty} ', placeholder: 'f(x)' },
      { label: 'Derivative', preview: '\\frac{dy}{dx}', before: '\\frac{d', placeholder: 'y', after: '}{dx}' },
      { label: 'Partial derivative', preview: '\\frac{\\partial f}{\\partial x}', before: '\\frac{\\partial ', placeholder: 'f', after: '}{\\partial x}' },
      { label: 'Expectation', preview: '\\mathbb{E}[X]', before: '\\mathbb{E}[', placeholder: 'X', after: ']' },
      { label: 'Conditional expectation', preview: '\\mathbb{E}[Y \\mid X]', before: '\\mathbb{E}[', placeholder: 'Y', after: ' \\mid X]' },
      { label: 'Variance', preview: '\\operatorname{Var}(X)', before: '\\operatorname{Var}(', placeholder: 'X', after: ')' },
      { label: '2 × 2 matrix', preview: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', before: '\\begin{bmatrix} ', placeholder: 'a', after: ' & b \\\\ c & d \\end{bmatrix}' },
      { label: '3 × 3 matrix', preview: '\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}', before: '\\begin{bmatrix} ', placeholder: 'a', after: ' & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}' },
      { label: 'Brackets that grow to fit', preview: '\\left( \\frac{a}{b} \\right)', before: '\\left( ', placeholder: 'x', after: ' \\right)' },
      { label: 'Estimate (hat)', preview: '\\hat{\\beta}', before: '\\hat{', placeholder: '\\beta', after: '}' },
      { label: 'Mean (bar)', preview: '\\bar{x}', before: '\\bar{', placeholder: 'x', after: '}' },
      { label: 'Change (delta)', preview: '\\Delta x', before: '\\Delta ', placeholder: 'x' },
      { label: 'Words inside an equation', preview: '\\text{GDP}', before: '\\text{', placeholder: 'GDP', after: '}' },
      { label: 'Cases', preview: '\\begin{cases} a & x > 0 \\\\ b & x \\le 0 \\end{cases}', before: '\\begin{cases} ', placeholder: 'a', after: ' & x > 0 \\\\ b & x \\le 0 \\end{cases}' },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    templates: [
      symbol('alpha', '\\alpha'),
      symbol('beta', '\\beta'),
      symbol('gamma', '\\gamma'),
      symbol('delta', '\\delta'),
      symbol('epsilon', '\\varepsilon'),
      symbol('theta', '\\theta'),
      symbol('lambda', '\\lambda'),
      symbol('mu', '\\mu'),
      symbol('pi', '\\pi'),
      symbol('rho', '\\rho'),
      symbol('sigma', '\\sigma'),
      symbol('tau', '\\tau'),
      symbol('phi', '\\phi'),
      symbol('chi', '\\chi'),
      symbol('omega', '\\omega'),
      symbol('capital gamma', '\\Gamma'),
      symbol('capital delta', '\\Delta'),
      symbol('capital theta', '\\Theta'),
      symbol('capital lambda', '\\Lambda'),
      symbol('capital pi', '\\Pi'),
      symbol('capital sigma', '\\Sigma'),
      symbol('capital phi', '\\Phi'),
      symbol('capital omega', '\\Omega'),
    ],
  },
  {
    id: 'relations',
    label: 'Relations',
    templates: [
      symbol('less than or equal to', '\\le'),
      symbol('greater than or equal to', '\\ge'),
      symbol('less than', '<'),
      symbol('greater than', '>'),
      symbol('not equal to', '\\neq'),
      symbol('approximately equal to', '\\approx'),
      symbol('identical to (defined as)', '\\equiv'),
      symbol('proportional to', '\\propto'),
      symbol('plus or minus', '\\pm'),
      symbol('multiplied by', '\\times'),
      symbol('dot (multiplied by)', '\\cdot'),
      symbol('infinity', '\\infty'),
      symbol('element of', '\\in'),
      symbol('tends to', '\\to'),
      symbol('implies', '\\Rightarrow'),
      symbol('if and only if', '\\iff'),
      symbol('for all', '\\forall'),
      symbol('there exists', '\\exists'),
      symbol('real numbers', '\\mathbb{R}'),
      symbol('transpose', '^{\\top}'),
    ],
  },
  {
    id: 'economics',
    label: 'Economics',
    templates: [
      { label: 'Linear regression', preview: 'Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i', before: 'Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i' },
      { label: 'Regression in matrix form', preview: 'y = X\\beta + \\varepsilon', before: 'y = X\\beta + \\varepsilon' },
      { label: 'OLS estimator', preview: '\\hat{\\beta} = (X^{\\top}X)^{-1}X^{\\top}y', before: '\\hat{\\beta} = (X^{\\top}X)^{-1}X^{\\top}y' },
      { label: 'National income identity', preview: 'Y = C + I + G + (X - M)', before: 'Y = C + I + G + (X - M)' },
      { label: 'Profit maximisation', preview: 'MR = MC', before: 'MR = MC' },
      { label: 'Cobb–Douglas production', preview: 'Y = A K^{\\alpha} L^{1-\\alpha}', before: 'Y = A K^{\\alpha} L^{1-\\alpha}' },
      { label: 'Price elasticity of demand', preview: '\\varepsilon_d = \\frac{\\%\\Delta Q}{\\%\\Delta P}', before: '\\varepsilon_d = \\frac{\\%\\Delta Q}{\\%\\Delta P}' },
      { label: 'Present value', preview: 'PV = \\sum_{t=1}^{T} \\frac{CF_t}{(1+r)^t}', before: 'PV = \\sum_{t=1}^{T} \\frac{CF_t}{(1+r)^t}' },
      { label: 'Compound growth', preview: 'Y_t = Y_0 (1+g)^t', before: 'Y_t = Y_0 (1+g)^t' },
      { label: 'Fisher equation', preview: '1 + i = (1 + r)(1 + \\pi^{e})', before: '1 + i = (1 + r)(1 + \\pi^{e})' },
      { label: 'Phillips curve', preview: '\\pi_t = \\pi_t^{e} - \\beta (u_t - u_n)', before: '\\pi_t = \\pi_t^{e} - \\beta (u_t - u_n)' },
      { label: 'Taylor rule', preview: 'i_t = r^{*} + \\pi_t + 0.5(\\pi_t - \\pi^{*}) + 0.5(y_t - \\bar{y}_t)', before: 'i_t = r^{*} + \\pi_t + 0.5(\\pi_t - \\pi^{*}) + 0.5(y_t - \\bar{y}_t)' },
      { label: 'Expected utility', preview: '\\mathbb{E}[U] = \\sum_{i} p_i \\, U(x_i)', before: '\\mathbb{E}[U] = \\sum_{i} p_i \\, U(x_i)' },
      { label: 'Standard deviation', preview: '\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i - \\bar{x})^2}', before: '\\sigma = \\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}(x_i - \\bar{x})^2}' },
      { label: 'Lagrangian', preview: '\\mathcal{L} = U(x, y) + \\lambda (M - p_x x - p_y y)', before: '\\mathcal{L} = U(x, y) + \\lambda (M - p_x x - p_y y)' },
    ],
  },
]

/**
 * Inserts a template into `value` at the selection [start, end). Returns the new
 * value and the range to select afterwards (the placeholder, or the end).
 */
export function applyTemplate(value: string, start: number, end: number, template: MathTemplate): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(start, end)
  const middle = selected && template.placeholder !== undefined ? selected : (template.placeholder ?? '')
  const inserted = `${template.before}${middle}${template.after ?? ''}`
  const next = value.slice(0, start) + inserted + value.slice(end)
  const middleStart = start + template.before.length
  // Select the placeholder so typing replaces it; keep a wrapped selection unselected.
  if (template.placeholder !== undefined && !selected) {
    return { value: next, selectionStart: middleStart, selectionEnd: middleStart + middle.length }
  }
  const caret = start + inserted.length
  return { value: next, selectionStart: caret, selectionEnd: caret }
}
