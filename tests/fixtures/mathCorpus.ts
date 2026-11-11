/**
 * Representative economics, finance and econometrics equations, plus KaTeX
 * features that exercise every kind of markup it emits (SVG delimiters and
 * arrows, tables, colour boxes, rules, struck-out text). Shared by the math
 * unit tests and the browser tests.
 */
export const ECONOMICS_EQUATIONS: Array<{ name: string; latex: string; display: boolean }> = [
  { name: 'profit maximisation', latex: 'MR = MC', display: false },
  { name: 'national income identity', latex: 'Y = C + I + G + (X - M)', display: true },
  { name: 'linear regression', latex: 'Y_i = \\beta_0 + \\beta_1 X_i + \\varepsilon_i', display: true },
  { name: 'summation', latex: '\\sum_{i=1}^{n} x_i', display: true },
  { name: 'marginal utility', latex: '\\frac{\\partial U}{\\partial x}', display: true },
  { name: 'matrix', latex: '\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}', display: true },
  { name: 'OLS estimator', latex: '\\hat{\\beta} = (X^{\\top}X)^{-1}X^{\\top}y', display: true },
  { name: 'present value', latex: 'PV = \\sum_{t=1}^{T} \\frac{CF_t}{(1+r)^t}', display: true },
  { name: 'Cobb-Douglas', latex: 'Y = A K^{\\alpha} L^{1-\\alpha}', display: true },
  { name: 'price elasticity', latex: '\\varepsilon_d = \\frac{\\partial Q}{\\partial P} \\cdot \\frac{P}{Q}', display: true },
  { name: 'expectation', latex: '\\mathbb{E}[X \\mid Y] = \\int_{-\\infty}^{\\infty} x \\, f(x \\mid y)\\, dx', display: true },
  { name: 'variance', latex: '\\operatorname{Var}(X) = \\mathbb{E}\\left[(X - \\mu)^2\\right]', display: true },
  { name: 'limit', latex: '\\lim_{n \\to \\infty} \\left(1 + \\frac{r}{n}\\right)^{n} = e^{r}', display: true },
  { name: 'square root rule', latex: '\\sigma_T = \\sigma \\sqrt{T}', display: false },
  { name: 'inequality', latex: '0 \\le \\alpha < 1, \\quad \\beta \\geq 0, \\quad x \\neq y', display: false },
  { name: 'Euler equation', latex: "u'(c_t) = \\beta (1 + r) \\, \\mathbb{E}_t\\left[u'(c_{t+1})\\right]", display: true },
  { name: 'Taylor rule', latex: 'i_t = r^{*} + \\pi_t + 0.5(\\pi_t - \\pi^{*}) + 0.5(y_t - \\bar{y}_t)', display: true },
  { name: 'Black-Scholes', latex: 'C = S_0 N(d_1) - K e^{-rT} N(d_2)', display: true },
  { name: 'cases', latex: 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}', display: true },
  { name: 'aligned system', latex: '\\begin{aligned} Y &= C + I \\\\ C &= a + bY \\end{aligned}', display: true },
  { name: 'Lagrangian', latex: '\\mathcal{L} = U(x, y) + \\lambda (M - p_x x - p_y y)', display: true },
  { name: 'derivative', latex: '\\frac{d}{dx} x^{n} = n x^{n-1}', display: false },
  { name: 'binomial', latex: '\\binom{n}{k} p^k (1-p)^{n-k}', display: true },
]

/** KaTeX features that produce SVG, tables, boxes and other less common markup. */
export const KATEX_FEATURE_CORPUS: string[] = [
  '\\sqrt[3]{x^2+1}',
  '\\overrightarrow{AB} \\xrightarrow[under]{over} \\xleftarrow{x}',
  '\\widehat{abc} \\overbrace{a+b}^{n} \\underbrace{a+b}_{n}',
  '\\cancel{x} \\bcancel{y} \\xcancel{z} \\sout{w}',
  '\\boxed{x} \\fcolorbox{red}{yellow}{x} \\colorbox{yellow}{y}',
  '\\color{red}{x} \\textcolor{#1a2744}{y}',
  '\\big( \\Big( \\bigg( \\Bigg( \\left\\{ \\frac{a}{b} \\right\\}',
  '\\begin{array}{c|c} a & b \\\\ \\hline c & d \\end{array}',
  '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} \\begin{smallmatrix} a & b \\end{smallmatrix}',
  '\\rule{2em}{0.5em} \\kern{1em} \\phantom{x} \\raisebox{0.25em}{x}',
  '\\stackrel{!}{=} \\overset{a}{b} \\underset{a}{b} \\vec{v} \\dot{x} \\ddot{x}',
  '\\Huge x \\tiny y',
  '\\mathfrak{g} \\mathbf{X}\\boldsymbol{\\beta} \\mathrm{GDP}',
  '\\text{\\$5 and \\$10 < \\$20 \\& more}',
]
