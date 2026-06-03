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

// ── Trophy system ─────────────────────────────────────────────────────────────

export const TROPHY_THRESHOLDS = {
  BRONZE: 100,
  SILVER: 1000,
  GOLD: 10000,
} as const

export type TrophyTier = keyof typeof TROPHY_THRESHOLDS

// ── Writer gamification ─────────────────────────────────────────────────────

/** Values stored in writer_achievements.type. */
export const ACHIEVEMENT_TYPES = {
  FIRST_PUBLISH: 'first_publish',
  SERIES_COMPLETE: 'series_complete',
} as const

export type AchievementType = (typeof ACHIEVEMENT_TYPES)[keyof typeof ACHIEVEMENT_TYPES]

/** notifications.type value used for gamification notifications. */
export const NOTIFICATION_TYPE_ACHIEVEMENT = 'achievement'

/**
 * Engagement-score weights. All inputs are on a 0-100 scale.
 *
 * NOTE: the brief wrote bookmark/comment coefficients of 30 and 20, but its own
 * worked example (avgReadDepth 80, 2 bookmarks, 1 comment, 10 views => 40.8) and
 * its stated "roughly 0-100" range are only satisfiable with 0.03 and 0.02. The
 * worked example plus the range are authoritative, so those values are used.
 */
export const ENGAGEMENT_WEIGHTS = {
  READ_DEPTH: 0.5,
  BOOKMARK_RATE: 0.03,
  COMMENT_RATE: 0.02,
} as const

/** Cron endpoints. POST only, authorised with a Bearer CRON_SECRET header. */
export const CRON_ROUTES = {
  recalculateStreaks: '/api/cron/recalculate-streaks',
  updateEngagementScores: '/api/cron/update-engagement-scores',
} as const

/** Session-protected gamification endpoints consumed by the writer dashboard. */
export const GAMIFICATION_API_ROUTES = {
  streak: '/api/user/streak',
  achievements: '/api/user/achievements',
  achievementsMarkSeen: '/api/user/achievements/mark-seen',
} as const
