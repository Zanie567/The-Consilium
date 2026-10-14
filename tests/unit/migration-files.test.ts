/**
 * Keeps supabase/migrations usable by the Supabase CLI from here on (issue #129, docs/remediation/migration-registry.md).
 *
 * The CLI reads the version from a file name's leading digits, so `20261010_a.sql` and `20261010_b.sql` are one
 * version, and a file without a leading timestamp is skipped. The names below predate this rule and are frozen until
 * the approved reconciliation renames them; every NEW file must carry a unique 14-digit version, and rollback scripts
 * belong in supabase/manual/, never in migrations/ (the CLI would run them forward).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'

const LEGACY = new Set([
  '20260408_enable_rls.sql',
  '20260408_restrict_column_grants.sql',
  '20260903_enable_rls_remaining_tables.sql',
  '20261001_team_member_user_link.sql',
  '20261005_user_display_titles.sql',
  '20261005_user_display_titles_rollback.sql',
  '20261006_member_onboarding.sql',
  '20261010_debate_lifecycle.sql',
  '20261010_team_member_updated_at.sql',
  '20261011_hidden_debate_article_guard.sql',
  'add_article_comments.sql',
  'add_article_comments_quoted_text.sql',
])
const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))

describe('supabase/migrations file names', () => {
  it('every file that is not a frozen legacy name has a 14-digit version and a snake_case name', () => {
    const bad = files.filter((f) => !LEGACY.has(f) && !/^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    expect(bad).toEqual([])
  })

  it('no two files share the version the CLI derives from the leading digits (beyond the frozen legacy pairs)', () => {
    const versions = files.filter((f) => !LEGACY.has(f)).map((f) => f.match(/^\d+/)?.[0])
    const legacyVersions = new Set([...LEGACY].map((f) => f.match(/^\d+/)?.[0]).filter(Boolean))
    expect(versions.filter((v, i) => versions.indexOf(v) !== i || legacyVersions.has(v))).toEqual([])
  })

  it('no new rollback script is placed where the CLI would apply it forward', () => {
    expect(files.filter((f) => /rollback|revert|down/i.test(f) && !LEGACY.has(f))).toEqual([])
  })

  it('the frozen list only shrinks: every legacy name still exists until it is reconciled', () => {
    // When the reconciliation renames a legacy file, remove it from LEGACY in the same change.
    expect([...LEGACY].filter((f) => !files.includes(f))).toEqual([])
  })
})
