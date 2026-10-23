import type { Role } from '@prisma/client'

export const ALL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] as const satisfies readonly Role[]
export const ADMIN_ONLY = ['ADMIN'] as const satisfies readonly Role[]
export const EDITORIAL_MANAGEMENT_ROLES = ['ADMIN', 'EDITOR'] as const satisfies readonly Role[]
export const ARTICLE_MUTATION_ROLES = ['ADMIN', 'EDITOR', 'WRITER'] as const satisfies readonly Role[]
// Roles that publish under their own name, so a public author page (/author/<slug or id>) is
// meant to exist for them. Readers and growth staff do not write, so nothing offers to share
// a link to a page about them.
export const PUBLIC_AUTHOR_PROFILE_ROLES = ARTICLE_MUTATION_ROLES
export const ANALYTICS_ACCESS_ROLES = ['ADMIN', 'GROWTH'] as const satisfies readonly Role[]
export const EDITORIAL_PORTAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] as const satisfies readonly Role[]
export const EDITOR_USER_TARGET_ROLES = ['WRITER', 'READER'] as const satisfies readonly Role[]
// Who can see the editorial calendar (nav link, page, and API all read this).
// To open the calendar to editors later, add 'EDITOR' here and nothing else.
export const CALENDAR_ACCESS_ROLES = ['ADMIN'] as const satisfies readonly Role[]
// Who can see the reader predictions league (the /predictions pages and the
// submission API all read this). The feature is in an admin-only trial; to
// open it to every signed-in reader, change this to ALL_ROLES and nothing else.
export const PREDICTIONS_ACCESS_ROLES = ['ADMIN'] as const satisfies readonly Role[]
// Who can create, edit, close, cancel, and resolve prediction events in the
// editorial portal. This stays admin-only even after the league opens up.
export const PREDICTIONS_MANAGE_ROLES = ['ADMIN'] as const satisfies readonly Role[]
// Who can manage the economics glossary (the /editorial/glossary page, the
// glossary API, and the site-wide linking switch all read this). To let
// editors curate terms later, add 'EDITOR' here and nothing else.
export const GLOSSARY_MANAGE_ROLES = ['ADMIN'] as const satisfies readonly Role[]
// Who can open the read-through page (/editorial/readers and its API).
// Everyone here sees their own articles only; ADMIN may view any author's.
// Who can approve and publish a post-publication correction, clarification or update notice.
// The public Corrections Policy promises approval by a senior editor; the only role above EDITOR is
// ADMIN, so editors prepare and submit, administrators approve. To let editors publish their own
// corrections, add 'EDITOR' here and nothing else (and update /corrections to match).
export const CORRECTION_APPROVAL_ROLES = ['ADMIN'] as const satisfies readonly Role[]
// Who can prepare a correction and submit it for approval (category scope still applies to EDITOR).
export const CORRECTION_PREPARE_ROLES = EDITORIAL_MANAGEMENT_ROLES
export const READ_THROUGH_ACCESS_ROLES = ['ADMIN', 'EDITOR', 'WRITER'] as const satisfies readonly Role[]
// Newsletter campaigns (/editorial/newsletter and /api/editorial/newsletter/*). Every route re-checks.
//   view, preview, audit trail, delivery status                         admins, editors, growth
//   build, rebuild, edit (intro/subject/preview, leave articles out),   admins, editors, growth
//   cancel, prepare special alerts for approval
//   pause all sending (a safety brake anyone preparing mail can pull)   admins, editors, growth
//   approve = schedule a send; resume sending; weekly auto-send          admins ONLY
export const NEWSLETTER_VIEW_ROLES = ['ADMIN', 'EDITOR', 'GROWTH'] as const satisfies readonly Role[]
export const NEWSLETTER_EDIT_ROLES = NEWSLETTER_VIEW_ROLES
export const NEWSLETTER_APPROVE_ROLES = ['ADMIN'] as const satisfies readonly Role[]
export const NEWSLETTER_PAUSE_ROLES = NEWSLETTER_VIEW_ROLES

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value)
}

export function isAllowedRole(value: unknown, allowedRoles: readonly Role[]): value is Role {
  return isRole(value) && allowedRoles.includes(value)
}
