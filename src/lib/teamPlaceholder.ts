/**
 * Tells a disposable, auto-generated Meet the Team placeholder from a genuine profile.
 *
 * When someone claims an invitation, `ensureProfileCard` creates a HIDDEN card carrying nothing but their
 * account name and the default title for their role. That card then blocks linking the person's real,
 * existing public profile ("this account already has a profile"). It is only safe to replace such a card
 * when nobody has written anything in it, so this check is deliberately strict: ANY real content, any
 * deviation from the generated defaults, or any visibility makes it a genuine profile that an administrator
 * must unlink or delete as a separate, deliberate step. Pure: shared by the server (which enforces it) and
 * the admin screen (which only explains it). Safe to import from client code.
 */
import { defaultPublicAppointment } from '@/lib/teamProfiles'

/** Where a card created by a claim sits; mirrors NEW_CARD_ORDER in teamCards/membership. */
const GENERATED_ORDER = 1000

export interface PlaceholderCard {
  name: string
  role: string
  publicTier: string | null
  bio: string | null
  image: string | null
  email: string | null
  order: number
  isActive: boolean
}
export interface PlaceholderAccount { name: string | null; email: string; role: string }

export interface PlaceholderAssessment {
  disposable: boolean
  /** Plain-language reasons the card counts as genuine. Empty when disposable. */
  genuineBecause: string[]
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

export function assessPlaceholder(card: PlaceholderCard, account: PlaceholderAccount): PlaceholderAssessment {
  const why: string[] = []
  if (card.isActive) why.push('it is visible on the Meet the Team page')
  if (card.bio?.trim()) why.push('it has a biography')
  if (card.image?.trim()) why.push('it has a photo')
  if (card.email?.trim()) why.push('it has a contact email')
  if (card.order !== GENERATED_ORDER) why.push('it has been placed by an administrator')
  const appointment = defaultPublicAppointment(account.role)
  const defaultRole = appointment?.role ?? ''
  const defaultTier = appointment?.publicTier ?? null
  if (card.role.trim() !== defaultRole) why.push('its public title was set by hand')
  if ((card.publicTier ?? null) !== defaultTier) why.push('its public placement was set by hand')
  const name = norm(card.name)
  if (name && name !== norm(account.name) && name !== norm(account.email)) why.push('its name was written by a person')
  return { disposable: why.length === 0, genuineBecause: why }
}
