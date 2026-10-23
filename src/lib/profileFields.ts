/**
 * The contributor details a person keeps in two places (pure, client-safe).
 *
 * Name, biography and photo are stored on the account (`User`: article bylines, comments, the
 * author page when there is no public team card) AND on the linked Meet the Team card
 * (`TeamMember`: the Our Team page and the author page when the card is public). Every editing
 * screen saves them through one server function (src/lib/contributorProfile.ts), which writes the
 * fields a person changed to both records at once. This file holds the rules both sides share:
 * which record a form shows, which fields still differ from before that rule existed, and what a
 * save will publish.
 *
 * Nothing here ever decides permissions, title, placement, order, visibility or ownership.
 */
import { TEAM_PROFILE_ROLES } from '@/lib/teamProfiles'
import { normalizePublicPosition, resolvePublicTitleLabel } from '@/lib/displayTitles'
import { publicationBlockers } from '@/lib/teamVisibility'

export const SHARED_FIELDS = ['name', 'bio', 'image'] as const
export type SharedField = (typeof SHARED_FIELDS)[number]
export type SharedValues = Record<SharedField, string | null>

/** Blank and missing mean the same thing: no value. */
export function normalizeShared(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' ? null : trimmed
}

export function sameShared(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeShared(a) === normalizeShared(b)
}

export function pickShared(record: { name: string | null; bio: string | null; image: string | null }): SharedValues {
  return { name: normalizeShared(record.name), bio: normalizeShared(record.bio), image: normalizeShared(record.image) }
}

/**
 * Whether saving these fields also writes the linked card. Only an account that may edit its own
 * card (a staff role) has its card kept in step when it edits itself; a reader whose old card an
 * administrator kept edits only the account, exactly as before. An administrator editing someone
 * always keeps an existing linked card in step.
 */
export function cardFollowsAccount(input: { role: string; hasCard: boolean; byAdministrator: boolean }): boolean {
  if (!input.hasCard) return false
  return input.byAdministrator || (TEAM_PROFILE_ROLES as readonly string[]).includes(input.role)
}

export interface SharedProfileView {
  /** What the form shows and what `expected` is compared against: the card when it is kept in step, else the account. */
  values: SharedValues
  /** True when the form edits the card and the account together. */
  linked: boolean
  /**
   * Fields where the account still holds something different from the card (details entered on
   * the two screens before they were joined). The value is the account's, shown so the person can
   * choose it; nothing is overwritten until they save that field.
   */
  accountDiffers: Partial<Record<SharedField, string | null>>
}

export function sharedProfileView(
  account: SharedValues,
  card: SharedValues | null,
  linked: boolean,
): SharedProfileView {
  if (!linked || !card) return { values: account, linked: false, accountDiffers: {} }
  const accountDiffers: SharedProfileView['accountDiffers'] = {}
  for (const field of SHARED_FIELDS) {
    if (!sameShared(account[field], card[field])) accountDiffers[field] = account[field]
  }
  return { values: card, linked: true, accountDiffers }
}

/** Plain-language names for the notices. */
export const SHARED_FIELD_LABEL: Record<SharedField, string> = {
  name: 'name',
  bio: 'biography',
  image: 'photo',
}

// ── What a save will publish ─────────────────────────────────────────────────

export interface CardPublicationFacts {
  /** The administrator's Publish switch. */
  isActive: boolean
  /** Public title shown on the card ("Writer"). Empty means it cannot appear. */
  positionLabel: string
  /** Something unrelated to name and biography keeps it off the page (suspended or test account, no title). */
  blockedRegardless: boolean
}

export interface PublicPreview {
  /** The author page header (/author/[slug]). */
  author: SharedValues
  /** The Our Team card, when the person has one; `onPublicPage` says whether readers see it. */
  teamCard: (SharedValues & { onPublicPage: boolean; positionLabel: string }) | null
}

/**
 * What the public pages would show if `pending` (the fields about to be saved) were saved now,
 * using exactly the rules the pages use: the Our Team card shows the card's own values (initials
 * without a photo); the author page shows the account name, and the card's biography and photo
 * while the card is public, falling back to the account photo when the card has none
 * (visibleAuthorProfile in teamProfiles.ts).
 */
export function previewPublicProfile(input: {
  view: SharedProfileView
  card: CardPublicationFacts | null
  pending: Partial<SharedValues>
}): PublicPreview {
  const { view, card, pending } = input
  const clean = (values: Partial<SharedValues>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeShared(v)])) as Partial<SharedValues>
  const shown = { ...view.values, ...clean(pending) }
  if (!view.linked || !card) {
    return { author: shown, teamCard: null }
  }
  // The account keeps its own value only for fields that differ and are not being saved.
  const account: SharedValues = { ...view.values, ...view.accountDiffers, ...clean(pending) }
  const onPublicPage = card.isActive && !card.blockedRegardless && shown.name !== null && shown.bio !== null
  return {
    author: {
      name: account.name,
      bio: onPublicPage ? shown.bio : account.bio,
      image: onPublicPage ? shown.image ?? account.image : account.image,
    },
    teamCard: { ...shown, onPublicPage, positionLabel: card.positionLabel },
  }
}

export interface ProfileEditorState {
  view: SharedProfileView
  card: CardPublicationFacts | null
}

/**
 * What a self-service editor (the account page or the editorial Team Profile) starts from. Both
 * screens call this, so for a linked contributor they always show the same values.
 */
export function profileEditorState(
  account: { name: string | null; bio: string | null; image: string | null; role: string; email: string; isActive: boolean; isBanned: boolean; displayTitles?: unknown },
  card: { name: string; bio: string | null; image: string | null; role: string; isActive: boolean } | null,
  options: { testingMode: boolean },
): ProfileEditorState {
  const linked = cardFollowsAccount({ role: account.role, hasCard: Boolean(card), byAdministrator: false })
  const view = sharedProfileView(pickShared(account), card ? pickShared(card) : null, linked)
  if (!card || !linked) return { view, card: null }
  const position = normalizePublicPosition(card.role)
  // Name and biography come from the form; every other reason a card stays off the page does not.
  const blockedRegardless = publicationBlockers({ name: 'x', position, bio: 'x' }, account, options).length > 0
  return {
    view,
    card: {
      isActive: card.isActive,
      positionLabel: resolvePublicTitleLabel({ displayTitles: account.displayTitles, cardTitle: position }) ?? '',
      blockedRegardless,
    },
  }
}
