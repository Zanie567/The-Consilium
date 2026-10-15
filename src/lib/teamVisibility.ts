/**
 * The one definition of whether a Meet the Team card is on the public page, and why not.
 *
 * Shared by the public roster (which enforces it), the publish action (which refuses an ineligible card) and the
 * admin screen (which explains it), so the three can never disagree. Pure and client-safe.
 *
 * Two independent things decide publication:
 *   - the administrator's switch (`TeamMember.isActive`), which only an administrator can change; and
 *   - eligibility: the card says who the person is, what they do and a little about them (name, public position,
 *     biography), and its linked account is active, not suspended and not an internal test account.
 * A card is public only when both hold. A photo is optional (the card draws initials). Placeholder-looking text
 * ("Bio to be added") is reported as a note for the administrator; it never hides a card on its own.
 *
 * Unlinked (legacy) cards keep their historical behaviour: the switch alone decides, so nothing already public
 * disappears. Publishing one through the publish action still requires name, position and biography.
 */

export interface VisibilityCard {
  name: string
  /** The public position (`TeamMember.role`). */
  position: string
  bio: string | null
  image: string | null
  /** The administrator's switch (`TeamMember.isActive`). */
  visible: boolean
}

/** The linked account, or null for a legacy card that belongs to no account. */
export interface VisibilityAccount {
  name: string | null
  email: string
  isActive: boolean
  isBanned: boolean
}

export type PublicationStatus = 'published' | 'hidden' | 'incomplete' | 'ineligible'

export type PublicationBlocker = 'name' | 'position' | 'bio' | 'account-inactive' | 'account-suspended' | 'test-account'
export type PublicationNote = 'placeholder-bio' | 'no-photo' | 'legacy-incomplete'

export interface PublicationAssessment {
  status: PublicationStatus
  /** The administrator's switch. */
  visible: boolean
  /** What the public page actually shows right now. */
  onPublicPage: boolean
  /** An administrator may switch it on and it will then appear. */
  canPublish: boolean
  blockers: PublicationBlocker[]
  notes: PublicationNote[]
}

const filled = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0

/** Accounts created for testing; excluded from every public listing unless Testing Mode is on. */
export function isTestAccountEmail(email: string): boolean {
  return email.trim().toLowerCase().startsWith('test-')
}

/**
 * Generic stand-in text an administrator typed to fill the field ("Bio to be added", "TBC", "Coming soon").
 * Deliberately narrow: the whole biography must be such a phrase, so a real biography that happens to contain
 * "coming soon" is never flagged.
 */
const PLACEHOLDER_LABEL = String.raw`(?:(?:bio|biography|description|about)\s*[:\-–]?\s*)?`
const PLACEHOLDER_PHRASE = String.raw`(?:to be (?:added|confirmed|written|updated)(?: soon| later)?|coming soon|tbc|tbd|tba|to follow|placeholder|lorem ipsum.*|add (?:a )?(?:bio|biography) here)`
const PLACEHOLDER_BIO = new RegExp(`^${PLACEHOLDER_LABEL}${PLACEHOLDER_PHRASE}$`)

export function isPlaceholderBio(bio: string | null | undefined): boolean {
  if (!filled(bio)) return false
  const text = bio!.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!…\s]+$/u, '')
  return PLACEHOLDER_BIO.test(text)
}

/** What stops a card from being shown, whatever the switch says. Empty when it is eligible. */
export function publicationBlockers(
  card: Pick<VisibilityCard, 'name' | 'position' | 'bio'>,
  account: VisibilityAccount | null,
  options: { testingMode?: boolean } = {},
): PublicationBlocker[] {
  const blockers: PublicationBlocker[] = []
  // A linked card falls back to the account's name, exactly as the public page does.
  if (!filled(card.name) && !filled(account?.name)) blockers.push('name')
  if (!filled(card.position)) blockers.push('position')
  if (!filled(card.bio)) blockers.push('bio')
  if (account) {
    if (account.isBanned) blockers.push('account-suspended')
    else if (!account.isActive) blockers.push('account-inactive')
    if (isTestAccountEmail(account.email) && !options.testingMode) blockers.push('test-account')
  }
  return blockers
}

export function assessPublication(
  card: VisibilityCard,
  account: VisibilityAccount | null,
  options: { testingMode?: boolean } = {},
): PublicationAssessment {
  const blockers = publicationBlockers(card, account, options)
  const accountBlocked = blockers.some((b) => b === 'account-inactive' || b === 'account-suspended' || b === 'test-account')
  // Legacy cards: the switch alone decides (unchanged public behaviour); their gaps are notes, not blockers.
  const legacy = account === null
  const onPublicPage = card.visible && (legacy || blockers.length === 0)

  const notes: PublicationNote[] = []
  if (isPlaceholderBio(card.bio)) notes.push('placeholder-bio')
  if (!filled(card.image)) notes.push('no-photo')
  if (legacy && onPublicPage && blockers.length > 0) notes.push('legacy-incomplete')

  let status: PublicationStatus
  if (onPublicPage) status = 'published'
  else if (accountBlocked) status = 'ineligible'
  else if (blockers.length > 0) status = 'incomplete'
  else status = 'hidden'

  return {
    status,
    visible: card.visible,
    onPublicPage,
    canPublish: blockers.length === 0,
    blockers: legacy && onPublicPage ? [] : blockers,
    notes,
  }
}

// ── Plain-language explanations, for the admin screen and the publish refusal ─────────────

export const BLOCKER_TEXT: Record<PublicationBlocker, string> = {
  name: 'It has no name.',
  position: 'It has no public position (for example "Writer"). Only an administrator can set one.',
  bio: 'It has no biography.',
  'account-inactive': 'The linked account is deactivated.',
  'account-suspended': 'The linked account is suspended.',
  'test-account': 'The linked account is an internal test account, which is never listed publicly.',
}

export const NOTE_TEXT: Record<PublicationNote, string> = {
  'placeholder-bio': 'The biography looks like placeholder text. It still counts as a biography, but you may want to replace it.',
  'no-photo': 'No photo: the public card shows initials instead. A photo is optional.',
  'legacy-incomplete': 'This older profile has no linked account and is missing details, but it stays public as before.',
}

export const STATUS_LABEL: Record<PublicationStatus, string> = {
  published: 'Published',
  hidden: 'Hidden',
  incomplete: 'Incomplete',
  ineligible: 'Not eligible',
}

/** One sentence saying where the card stands, for the top of the editor. */
export function publicationSummary(a: PublicationAssessment): string {
  switch (a.status) {
    case 'published':
      return 'This profile is on the Our Team page.'
    case 'hidden':
      return 'This profile is ready but hidden. It is not on the Our Team page until an administrator publishes it.'
    case 'incomplete':
      return a.visible
        ? 'Publishing is switched on, but the profile is held back from the Our Team page until it is complete.'
        : 'This profile is hidden and cannot be published until it is complete.'
    case 'ineligible':
      return a.visible
        ? 'Publishing is switched on, but the profile is held back because of its linked account.'
        : 'This profile is hidden and cannot be published because of its linked account.'
  }
}
