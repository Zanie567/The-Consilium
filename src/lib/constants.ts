// ── Site identity ─────────────────────────────────────────────────────────────

export const SITE_NAME = 'The Consilium'
export const SITE_DESCRIPTION =
  'The official publication of the University of Edinburgh Economics Society. Rigorous analysis. Independent voice.'

// ── Contact ───────────────────────────────────────────────────────────────────

export const CONTACT_EMAIL = 'theconsilium.editor@gmail.com'

// ── Social ────────────────────────────────────────────────────────────────────

export const INSTAGRAM_URL = 'https://www.instagram.com/theconsilium.editor/'
export const FEEDBACK_FORM_URL = 'https://forms.gle/ufUnT7sDoKagnLqGA'

// ── URLs ──────────────────────────────────────────────────────────────────────

/** Canonical site URL. Falls back to the Vercel deployment URL, then the production domain. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://theconsilium.co.uk')

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

// ── Writer gamification ─────────────────────────────────────────────────────

/** Values stored in writer_achievements.type. */
export const ACHIEVEMENT_TYPES = {
  FIRST_PUBLISH: 'first_publish',
  SERIES_COMPLETE: 'series_complete',
} as const

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

/** Session-protected gamification endpoints consumed by the writer dashboard. */
export const GAMIFICATION_API_ROUTES = {
  streak: '/api/user/streak',
  achievements: '/api/user/achievements',
  achievementsMarkSeen: '/api/user/achievements/mark-seen',
} as const

/**
 * Writer-settable streak cadence, in ISO weeks. A streak continues as long as the
 * writer publishes at least once every `intervalWeeks` weeks, so a fortnightly
 * writer can set 2 and not lose their streak. MIN (1) reproduces the original
 * weekly streak; MAX bounds how sparse a cadence may be before it stops being a
 * streak.
 */
export const STREAK_INTERVAL_WEEKS = {
  MIN: 1,
  MAX: 8,
  DEFAULT: 1,
} as const

/**
 * Read-quality threshold. Engagement scores strictly above this render in gold on
 * the writer dashboard; scores at or below render in muted text.
 */
export const ENGAGEMENT_QUALITY_GOLD_THRESHOLD = 40

/**
 * A writer is flagged "at risk" on the Growth activity view once they have
 * published at least MIN_PUBLISHED articles but none in the last
 * MAX_DAYS_SINCE_PUBLISH days.
 */
export const WRITER_AT_RISK = {
  MIN_PUBLISHED: 2,
  MAX_DAYS_SINCE_PUBLISH: 30,
} as const

/**
 * Maximum length of a user's self-edited bio.
 *
 * Enforced BOTH in the account form and in PATCH /api/profile/account — the form
 * limit alone is a hint, not a guarantee, and this text renders on public pages
 * (author page, article bylines, the Meet the Team card and its dialog). Raised
 * from the form's original 300 when the team dialog began showing bios in full.
 */
export const MAX_BIO_LENGTH = 600

/** Longest display name an account may set. Mirrors the form's maxLength. */
export const MAX_NAME_LENGTH = 60

/**
 * Maximum size of a user-uploaded profile photo, in bytes.
 *
 * Smaller than the article-image allowance: an avatar renders at 128px at most,
 * and unlike article images this bucket is writable by every account. Enforced in
 * POST /api/upload and mirrored in the account form so an oversized file fails
 * before the upload rather than after it.
 */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024 // = MAX_SERVER_UPLOAD_BYTES (declared below)

/**
 * The largest file this app accepts through ITS OWN server (POST /api/upload, /api/team-profile).
 *
 * Vercel limits a Function's request body to 4.5 MB, and the platform rejects anything bigger
 * before our code runs, with a plain 413 that names no file or limit. A multipart body is the file
 * plus a few hundred bytes of form framing, so the file must stay clear of 4.5 MB: 4 MiB leaves
 * ~0.5 MiB of margin. The editor checks it before sending and the routes check it again.
 * Larger images would need a direct-to-storage (signed URL) upload instead of this path.
 */
export const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024

/** Vercel's documented Function request-body limit (4.5 MB), used to prove the margin above. */
export const VERCEL_REQUEST_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024

/** Largest article/cover image accepted. */
export const MAX_ARTICLE_IMAGE_BYTES = MAX_SERVER_UPLOAD_BYTES

/** Human-readable message for an image over MAX_ARTICLE_IMAGE_BYTES. */
export const ARTICLE_IMAGE_TOO_LARGE_MESSAGE = `File too large (max ${MAX_ARTICLE_IMAGE_BYTES / (1024 * 1024)} MB). Resize or compress the image and try again.`

// ── Site settings (key-value) ─────────────────────────────────────────────────

/** site_settings.key holding the editorial commissioning brief. */
export const COMMISSIONING_BRIEF_KEY = 'commissioning_brief'

/** Maximum length of the commissioning brief, in characters after trimming. */
export const COMMISSIONING_BRIEF_MAX_LENGTH = 1000

/**
 * site_settings.key holding the glossary linking switch. Value 'true' turns
 * term linking on for published articles; any other value (or a missing row)
 * means OFF, so the feature ships dark until an admin flips it on from
 * /editorial/glossary.
 */
export const GLOSSARY_ENABLED_KEY = 'glossary_linking_enabled'

/** Server-side validation bounds for glossary terms. */
export const GLOSSARY_LIMITS = {
  TERM_MAX: 80,
  ALIAS_MAX: 60,
  ALIASES_MAX_COUNT: 10,
  DEFINITION_MIN: 10,
  DEFINITION_MAX: 600,
  URL_MAX: 300,
} as const

/** Role-gated editorial endpoints consumed by portal pages and editor controls. */
export const EDITORIAL_API_ROUTES = {
  commissioningBrief: '/api/editorial/commissioning-brief',
  writerActivity: '/api/editorial/growth/writer-activity',
} as const

/**
 * Maximum size of a Meet the Team photo, in bytes. Set under Vercel's 4.5 MB
 * function request-body limit: a larger multipart upload would be cut off by the
 * platform with an unhelpful error before the route could reject it by name.
 */
export const MAX_TEAM_PHOTO_BYTES = 4 * 1024 * 1024 // = MAX_SERVER_UPLOAD_BYTES
