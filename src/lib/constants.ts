// ── Site identity ─────────────────────────────────────────────────────────────

export const SITE_NAME = 'The Consilium'
export const SITE_DESCRIPTION =
  'The official publication of the University of Edinburgh Economics Society. Rigorous analysis. Independent voice.'
export const SITE_TAGLINE = 'University of Edinburgh Economics Society'

// ── Contact ───────────────────────────────────────────────────────────────────

export const CONTACT_EMAIL = 'theconsilium.editor@gmail.com'

// ── Social ────────────────────────────────────────────────────────────────────

export const INSTAGRAM_URL = 'https://www.instagram.com/theconsilium.editor/'
export const LINKEDIN_URL = 'https://linkedin.com'
export const FEEDBACK_FORM_URL = 'https://forms.gle/ufUnT7sDoKagnLqGA'

// ── URLs ──────────────────────────────────────────────────────────────────────

/** Canonical site URL. Falls back to the Vercel deployment URL, then the production domain. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://theconsilium.co.uk')

export const LOGO_URL = `${SITE_URL}/logo.png`

// ── Routes ────────────────────────────────────────────────────────────────────

export const ROUTES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  profile: '/profile',
  editorial: '/editorial',
  editorialNew: '/editorial/articles/new',
  about: '/about',
  contact: '/contact',
  corrections: '/corrections',
  privacy: '/privacy',
  terms: '/terms',
  search: '/search',
  archive: '/archive',
  team: '/team',
  opinionDebate: '/opinion-debate',
  categories: {
    news: '/category/news',
    opinion: '/category/opinion',
    analysis: '/category/analysis',
    interviews: '/category/interviews',
  },
} as const

// ── Brand colours ─────────────────────────────────────────────────────────────
// These match the Tailwind CSS variables defined in globals.css.
// Use CSS variables in JSX wherever possible; these constants are for
// contexts that require raw hex values (e.g. Chart.js, canvas).

export const COLORS = {
  NAVY: '#1a2744',
  GOLD: '#c9a227',
  GOLD_ALT: '#c9a84c',
  CREAM: '#faf8f3',
} as const
