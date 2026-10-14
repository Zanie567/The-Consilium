/**
 * Keeps supabase/migrations usable by the Supabase CLI (issue #129, docs/remediation/migration-registry.md).
 *
 * The CLI reads the version from a file name's leading digits, so `20261010_a.sql` and `20261010_b.sql` are one
 * version, and a file without a leading timestamp is skipped. Every file therefore carries a unique 14-digit version,
 * and rollback scripts belong in supabase/manual/, never in migrations/ (the CLI would run them forward).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
const version = (f: string) => f.match(/^\d+/)?.[0]

// Production's registry rows that the Supabase API wrote under its own versions (as of 2026-10-14). The first file
// holds the exact SQL the registry recorded; the others point at the file that holds the change and must stay empty,
// so the same change is never applied twice.
const PRODUCTION_RECORDS = {
  '20260610222208_add_comments_hiddenbody_and_debate_votes_anoniphash.sql': 'sql',
  '20261003181523_team_member_user_link.sql': '20261001000000_team_member_user_link.sql',
  '20261006234853_public_appointments_testing_sessions.sql': '20261003231314_public_appointments_testing_sessions.sql',
  '20261006234931_member_onboarding.sql': '20261006000000_member_onboarding.sql',
} as const

describe('supabase/migrations file names', () => {
  it('every file has a 14-digit version and a snake_case name', () => {
    expect(files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f))).toEqual([])
  })

  it('no two files share the version the CLI derives from the leading digits', () => {
    const versions = files.map(version)
    expect(versions.filter((v, i) => versions.indexOf(v) !== i)).toEqual([])
  })

  it('no rollback script is placed where the CLI would apply it forward', () => {
    expect(files.filter((f) => /rollback|revert|down/i.test(f))).toEqual([])
    expect(readdirSync('supabase/manual')).toContain('20261005_user_display_titles_rollback.sql')
  })

  it("keeps a file for each of production's API-recorded registry versions; record-only files run no SQL", () => {
    for (const [record, target] of Object.entries(PRODUCTION_RECORDS)) {
      expect(files).toContain(record)
      if (target === 'sql') continue
      expect(files).toContain(target)
      const code = readFileSync(`supabase/migrations/${record}`, 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.trim().startsWith('--'))
      expect(code).toEqual([])
    }
  })
})
