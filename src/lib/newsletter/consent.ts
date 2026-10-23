import type { Prisma } from '@prisma/client'
import { emailHash } from './identity'

type Tx = Prisma.TransactionClient

export type ConsentAction =
  | 'SIGNUP_REQUESTED'
  | 'SIGNUP_IGNORED'
  | 'CONFIRMED'
  | 'PREFERENCES_UPDATED'
  | 'UNSUBSCRIBED'
  | 'SUPPRESSED'
  | 'RESUBSCRIBE_REFUSED'
  | 'MANAGE_LINK_REQUESTED'
  | 'LEGACY_IMPORTED'

export type ConsentSource =
  | 'signup_form'
  | 'confirm_page'
  | 'preference_centre'
  | 'legacy_unsubscribe_link'
  | 'manage_link_form'
  | 'resend_webhook'
  | 'admin'
  | 'system'

export interface ConsentEventInput {
  subscriberId: string | null
  identity: string
  action: ConsentAction
  source: ConsentSource
  weeklyDigest?: boolean | null
  specialAlerts?: boolean | null
  consentVersion?: string | null
  ipHash?: string | null
  userAgent?: string | null
  actor?: string | null
  detail?: Prisma.InputJsonValue
}

/** Appends one consent record. Always inside the transaction that made the change it records. */
export async function recordConsentEvent(tx: Tx, input: ConsentEventInput): Promise<void> {
  await tx.subscriberConsentEvent.create({
    data: {
      subscriberId: input.subscriberId,
      emailHash: emailHash(input.identity),
      action: input.action,
      source: input.source,
      weeklyDigest: input.weeklyDigest ?? null,
      specialAlerts: input.specialAlerts ?? null,
      consentVersion: input.consentVersion ?? null,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
      actor: input.actor ?? null,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    },
  })
}

/**
 * Suppression reasons. UNSUBSCRIBED only means "never re-subscribe without a fresh confirmation";
 * the others mean "never mail this address" until an administrator deliberately clears it.
 */
export type SuppressionReason = 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED' | 'PROVIDER_SUPPRESSED' | 'ADMIN'
export const HARD_SUPPRESSIONS: readonly SuppressionReason[] = ['BOUNCED', 'COMPLAINED', 'PROVIDER_SUPPRESSED', 'ADMIN']

const SEVERITY: Record<SuppressionReason, number> = { UNSUBSCRIBED: 0, BOUNCED: 1, PROVIDER_SUPPRESSED: 1, ADMIN: 2, COMPLAINED: 3 }

/** Records a suppression; a milder reason never overwrites a stronger one. */
export async function upsertSuppression(tx: Tx, identity: string, reason: SuppressionReason, source: string): Promise<void> {
  const key = emailHash(identity)
  const existing = await tx.newsletterSuppression.findUnique({ where: { emailHash: key } })
  if (existing && SEVERITY[existing.reason as SuppressionReason] >= SEVERITY[reason]) return
  await tx.newsletterSuppression.upsert({
    where: { emailHash: key },
    create: { emailHash: key, reason, source },
    update: { reason, source },
  })
}

export async function findSuppression(tx: Tx, identity: string): Promise<SuppressionReason | null> {
  const row = await tx.newsletterSuppression.findUnique({ where: { emailHash: emailHash(identity) }, select: { reason: true } })
  return (row?.reason as SuppressionReason | undefined) ?? null
}
