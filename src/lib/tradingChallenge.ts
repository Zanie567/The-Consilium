/**
 * The EconSoc Trading Challenge — the single source of truth for everything the
 * /trading-challenge page states.
 *
 * Maintainers: every value here is public. NEVER add the MarketWatch game password,
 * private Google Sheet or Apps Script links, membership exports or any participant
 * data. The password reaches verified members only through the existing
 * registration automation (Google Form → Sheet → Apps Script → email).
 *
 * To change what the page says, edit this file:
 *   - dates/prizes/links ........ the constants below
 *   - the student form .......... `registration.student.responderUrl` (null = unavailable)
 *   - non-student registration .. `registration.nonStudent` (an email to the committee)
 *   - announce winners .......... fill `results.winners` and set `results.published`
 *     ONLY after the committee has verified eligibility and announced them.
 */

export const TRADING_CHALLENGE_TIME_ZONE = 'Europe/London'

export type ChallengePhase = 'upcoming' | 'live' | 'closed'

/** A prize place. Amounts are whole pounds. */
export interface Prize {
  place: 1 | 2 | 3
  amountGbp: number
}

export interface Winner {
  place: 1 | 2 | 3
  /** MarketWatch display name, as announced by the committee. */
  displayName: string
  /** Final return as a percentage, only if independently verified and approved for publication. */
  finalReturnPct?: number
}

export interface RegistrationRoute {
  /** The public Google Forms responder URL, or null while the route is not ready. */
  responderUrl: string | null
}

export const TRADING_CHALLENGE = {
  name: 'The EconSoc Trading Challenge 2026–27',
  organiser: 'University of Edinburgh Economics Society',
  platform: 'MarketWatch Virtual Stock Exchange',

  /**
   * Calendar dates in Europe/London, as chosen when the game was created. The game itself
   * defines no published start/end time. MarketWatch's overview shows one day earlier
   * for both (Nov 9, 2026 – Mar 24, 2027); the cause is unconfirmed.
   */
  startDate: '2026-11-10',
  endDate: '2027-03-25',

  startingCapitalUsd: 100_000,
  prizes: [
    { place: 1, amountGbp: 100 },
    { place: 2, amountGbp: 50 },
    { place: 3, amountGbp: 25 },
  ] satisfies Prize[],

  links: {
    /** The private game. Joining it requires the password sent to verified members. */
    game: 'https://www.marketwatch.com/games/the-econsoc-trading-challenge-26-27',
    rankings: 'https://www.marketwatch.com/games/the-econsoc-trading-challenge-26-27/rankings',
    /** MarketWatch's Virtual Stock Exchange, where a free account is created. */
    marketwatch: 'https://www.marketwatch.com/games',
    /** EconSoc's official EUSA page, where paid membership is bought. */
    membership: 'https://www.eusa.ed.ac.uk/activities/view/economicssoc',
  },

  registration: {
    /** University of Edinburgh students: existing, tested automated verification. */
    student: {
      responderUrl:
        'https://docs.google.com/forms/d/e/1FAIpQLSeC6thVEEGseljEprbWRaGXqBUuDhfunC_5YzW7DqLy0ZT7zA/viewform',
    } as RegistrationRoute,
    /**
     * Paid non-student members email the committee, who register them and verify their
     * membership by hand. There is no form and nothing is automated: the email starts a
     * conversation, it does not confirm a place or send any login details.
     */
    nonStudent: {
      subject: 'Trading Challenge – Non-Student Registration',
      /** Prefilled message. Asks only for what the committee needs; never a password. */
      body: [
        'Hello EconSoc committee,',
        '',
        'I am a paid non-student EconSoc member and would like to register for the EconSoc Trading Challenge 2026–27.',
        '',
        'Full name: ',
        'MarketWatch display name: ',
        'Email address used to buy my EconSoc membership: ',
        '',
        'Thank you.',
        // CRLF: the line break RFC 6068 specifies for mailto bodies.
      ].join('\r\n'),
    },
  },

  /** EconSoc's contact address, as listed on its EUSA society page. */
  supportEmail: 'economics.society@ed.ac.uk',

  /** Markets available in the game, as configured on MarketWatch. */
  markets: 'Nasdaq, NYSE, NYSE American and OTC',
  // Other MarketWatch game settings (commission, order types, short selling, margin and
  // so on) are deliberately not published here: the game itself is the authority on
  // them. Leaving them off this page does not change anything on MarketWatch.

  /** Decisions the organisers still owe before the page can state them as rules. */
  pendingDecisions: {
    tieBreak: true,
  },

  results: {
    /** Flip to true only once winners are verified and officially announced. */
    published: false,
    winners: [] as Winner[],
  },
} as const

/** `mailto:` link for non-student registration, with the subject and prefilled message. */
export function nonStudentMailto(email: string = TRADING_CHALLENGE.supportEmail): string {
  const { subject, body } = TRADING_CHALLENGE.registration.nonStudent
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export const TOTAL_PRIZE_POOL_GBP = TRADING_CHALLENGE.prizes.reduce((sum, p) => sum + p.amountGbp, 0)

/** Today's calendar date (YYYY-MM-DD) in Europe/London. */
export function londonDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TRADING_CHALLENGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * The competition phase on a given instant. Dates are whole London calendar days:
 * live from the start date through the end date inclusive, closed from the day after.
 * Computed on the server only and passed down, so the client never re-derives it and
 * cannot disagree with the server render near midnight.
 */
export function challengePhase(now: Date, start: string = TRADING_CHALLENGE.startDate, end: string = TRADING_CHALLENGE.endDate): ChallengePhase {
  const today = londonDate(now)
  if (today < start) return 'upcoming'
  if (today <= end) return 'live'
  return 'closed'
}

/** Whole days from London-today until `date` (0 on the day itself, negative after). */
export function daysUntil(now: Date, date: string): number {
  const today = Date.parse(`${londonDate(now)}T00:00:00Z`)
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000)
}

/** Share of the trading window elapsed, 0–1, by London calendar day. */
export function windowProgress(now: Date, start: string = TRADING_CHALLENGE.startDate, end: string = TRADING_CHALLENGE.endDate): number {
  const today = Date.parse(`${londonDate(now)}T00:00:00Z`)
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  return Math.min(1, Math.max(0, (today - s) / (e - s)))
}

/** "10 November 2026" — formatted from the date string itself, independent of the server's zone. */
export function formatChallengeDate(date: string, opts: { withYear?: boolean; weekday?: boolean } = {}): string {
  const { withYear = true, weekday = false } = opts
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    ...(weekday ? { weekday: 'long' } : {}),
  }).format(new Date(`${date}T00:00:00Z`))
}

/**
 * Embed URL for a Google Forms responder link. Only docs.google.com form links are
 * accepted, so a mis-pasted URL can never put an arbitrary site in the page's iframe
 * (the CSP would block it anyway; this keeps the UI honest about it too).
 */
export function googleFormEmbedUrl(responderUrl: string | null): string | null {
  if (!responderUrl) return null
  let url: URL
  try {
    url = new URL(responderUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/forms\/d\/e\/[\w-]+\/viewform$/.test(url.pathname)) {
    return null
  }
  return `https://docs.google.com${url.pathname}?embedded=true`
}

/** Publishable winners: nothing is shown until the results are explicitly published. */
export function publishedWinners(results: { published: boolean; winners: readonly Winner[] } = TRADING_CHALLENGE.results): Winner[] {
  if (!results.published) return []
  return [...results.winners].sort((a, b) => a.place - b.place)
}
