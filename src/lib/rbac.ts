import type { Role } from '@prisma/client'

export const ALL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] as const satisfies readonly Role[]
export const ADMIN_ONLY = ['ADMIN'] as const satisfies readonly Role[]
export const EDITORIAL_MANAGEMENT_ROLES = ['ADMIN', 'EDITOR'] as const satisfies readonly Role[]
export const ARTICLE_MUTATION_ROLES = ['ADMIN', 'EDITOR', 'WRITER'] as const satisfies readonly Role[]
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

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value)
}

export function isAllowedRole(value: unknown, allowedRoles: readonly Role[]): value is Role {
  return isRole(value) && allowedRoles.includes(value)
}
