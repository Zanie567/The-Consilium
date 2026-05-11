import type { Role } from '@prisma/client'

export const ALL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] as const satisfies readonly Role[]
export const ADMIN_ONLY = ['ADMIN'] as const satisfies readonly Role[]
export const EDITORIAL_MANAGEMENT_ROLES = ['ADMIN', 'EDITOR'] as const satisfies readonly Role[]
export const ARTICLE_MUTATION_ROLES = ['ADMIN', 'EDITOR', 'WRITER'] as const satisfies readonly Role[]
export const ANALYTICS_ACCESS_ROLES = ['ADMIN', 'GROWTH'] as const satisfies readonly Role[]
export const EDITORIAL_PORTAL_ROLES = ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH'] as const satisfies readonly Role[]
export const EDITOR_USER_TARGET_ROLES = ['WRITER', 'READER'] as const satisfies readonly Role[]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value)
}

export function isAllowedRole(value: unknown, allowedRoles: readonly Role[]): value is Role {
  return isRole(value) && allowedRoles.includes(value)
}
