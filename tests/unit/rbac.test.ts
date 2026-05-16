/**
 * Unit tests for src/lib/rbac.ts
 */

import { describe, it, expect } from 'vitest'
import {
  isRole,
  isAllowedRole,
  ALL_ROLES,
  ADMIN_ONLY,
  EDITORIAL_MANAGEMENT_ROLES,
  ARTICLE_MUTATION_ROLES,
  ANALYTICS_ACCESS_ROLES,
  EDITORIAL_PORTAL_ROLES,
  EDITOR_USER_TARGET_ROLES,
} from '@/lib/rbac'

// ── isRole ────────────────────────────────────────────────────────────────────

describe('isRole', () => {
  it('accepts each valid role', () => {
    for (const role of ALL_ROLES) {
      expect(isRole(role)).toBe(true)
    }
  })

  it('rejects an unknown role string', () => {
    expect(isRole('SUPERADMIN')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isRole('')).toBe(false)
  })

  it('rejects lowercase role', () => {
    expect(isRole('admin')).toBe(false)
  })

  it('rejects null', () => {
    expect(isRole(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isRole(undefined)).toBe(false)
  })

  it('rejects a number', () => {
    expect(isRole(123)).toBe(false)
  })

  it('rejects an object', () => {
    expect(isRole({ role: 'ADMIN' })).toBe(false)
  })

  it('rejects an array', () => {
    expect(isRole(['ADMIN'])).toBe(false)
  })
})

// ── isAllowedRole ─────────────────────────────────────────────────────────────

describe('isAllowedRole', () => {
  it('ADMIN is allowed in ADMIN_ONLY', () => {
    expect(isAllowedRole('ADMIN', ADMIN_ONLY)).toBe(true)
  })

  it('EDITOR is NOT allowed in ADMIN_ONLY', () => {
    expect(isAllowedRole('EDITOR', ADMIN_ONLY)).toBe(false)
  })

  it('every role is allowed in ALL_ROLES', () => {
    for (const role of ALL_ROLES) {
      expect(isAllowedRole(role, ALL_ROLES)).toBe(true)
    }
  })

  it('invalid string is not allowed in ALL_ROLES', () => {
    expect(isAllowedRole('HACKER', ALL_ROLES)).toBe(false)
  })

  it('returns false for valid role against empty allowlist', () => {
    expect(isAllowedRole('ADMIN', [])).toBe(false)
  })

  it('null is not allowed in any list', () => {
    expect(isAllowedRole(null, ALL_ROLES)).toBe(false)
  })

  it('undefined is not allowed in any list', () => {
    expect(isAllowedRole(undefined, ALL_ROLES)).toBe(false)
  })

  it('GROWTH is allowed in ANALYTICS_ACCESS_ROLES', () => {
    expect(isAllowedRole('GROWTH', ANALYTICS_ACCESS_ROLES)).toBe(true)
  })

  it('READER is NOT allowed in ANALYTICS_ACCESS_ROLES', () => {
    expect(isAllowedRole('READER', ANALYTICS_ACCESS_ROLES)).toBe(false)
  })

  it('WRITER is NOT allowed in EDITORIAL_MANAGEMENT_ROLES', () => {
    expect(isAllowedRole('WRITER', EDITORIAL_MANAGEMENT_ROLES)).toBe(false)
  })

  it('ADMIN is allowed in EDITORIAL_MANAGEMENT_ROLES', () => {
    expect(isAllowedRole('ADMIN', EDITORIAL_MANAGEMENT_ROLES)).toBe(true)
  })

  it('EDITOR is allowed in EDITORIAL_MANAGEMENT_ROLES', () => {
    expect(isAllowedRole('EDITOR', EDITORIAL_MANAGEMENT_ROLES)).toBe(true)
  })

  it('READER is NOT allowed in ARTICLE_MUTATION_ROLES', () => {
    expect(isAllowedRole('READER', ARTICLE_MUTATION_ROLES)).toBe(false)
  })

  it('WRITER is allowed in ARTICLE_MUTATION_ROLES', () => {
    expect(isAllowedRole('WRITER', ARTICLE_MUTATION_ROLES)).toBe(true)
  })

  it('READER is NOT allowed in EDITORIAL_PORTAL_ROLES', () => {
    expect(isAllowedRole('READER', EDITORIAL_PORTAL_ROLES)).toBe(false)
  })

  it('GROWTH is allowed in EDITORIAL_PORTAL_ROLES', () => {
    expect(isAllowedRole('GROWTH', EDITORIAL_PORTAL_ROLES)).toBe(true)
  })

  it('WRITER is allowed in EDITOR_USER_TARGET_ROLES', () => {
    expect(isAllowedRole('WRITER', EDITOR_USER_TARGET_ROLES)).toBe(true)
  })

  it('READER is allowed in EDITOR_USER_TARGET_ROLES', () => {
    expect(isAllowedRole('READER', EDITOR_USER_TARGET_ROLES)).toBe(true)
  })

  it('ADMIN is NOT allowed in EDITOR_USER_TARGET_ROLES', () => {
    expect(isAllowedRole('ADMIN', EDITOR_USER_TARGET_ROLES)).toBe(false)
  })

  it('EDITOR is NOT allowed in EDITOR_USER_TARGET_ROLES', () => {
    expect(isAllowedRole('EDITOR', EDITOR_USER_TARGET_ROLES)).toBe(false)
  })
})

// ── Role constant shape ───────────────────────────────────────────────────────

describe('role constants', () => {
  it('ALL_ROLES contains exactly 5 roles', () => {
    expect(ALL_ROLES).toHaveLength(5)
  })

  it('ALL_ROLES contains ADMIN, EDITOR, WRITER, GROWTH, READER', () => {
    expect(ALL_ROLES).toContain('ADMIN')
    expect(ALL_ROLES).toContain('EDITOR')
    expect(ALL_ROLES).toContain('WRITER')
    expect(ALL_ROLES).toContain('GROWTH')
    expect(ALL_ROLES).toContain('READER')
  })

  it('ADMIN_ONLY contains only ADMIN', () => {
    expect(ADMIN_ONLY).toEqual(['ADMIN'])
  })

  it('EDITORIAL_MANAGEMENT_ROLES contains ADMIN and EDITOR only', () => {
    expect(EDITORIAL_MANAGEMENT_ROLES).toContain('ADMIN')
    expect(EDITORIAL_MANAGEMENT_ROLES).toContain('EDITOR')
    expect(EDITORIAL_MANAGEMENT_ROLES).not.toContain('WRITER')
    expect(EDITORIAL_MANAGEMENT_ROLES).not.toContain('READER')
    expect(EDITORIAL_MANAGEMENT_ROLES).not.toContain('GROWTH')
  })
})
