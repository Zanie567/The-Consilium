import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isLoopbackDatabase, requireSeedPassword } from '../../scripts/lib/seedCredentials'

describe('seed credentials', () => {
  it('recognises loopback databases, and only those', () => {
    for (const url of ['postgresql://postgres@localhost:5433/consilium', 'postgresql://postgres@127.0.0.1:55511/x', 'postgresql://postgres@[::1]:5432/x']) {
      expect(isLoopbackDatabase(url)).toBe(true)
    }
    expect(isLoopbackDatabase('postgresql://u:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres')).toBe(false)
    expect(isLoopbackDatabase('postgresql://postgres@localhost:5432/x?host=db.example.com')).toBe(false)
    expect(isLoopbackDatabase('postgresql://postgres@localhost:5432/x?hostaddr=10.0.0.1')).toBe(false)
    expect(isLoopbackDatabase(undefined)).toBe(false)
    expect(isLoopbackDatabase('not a url')).toBe(false)
  })

  it('requires a password of at least 16 characters from the environment for a non-local database', () => {
    expect(() => requireSeedPassword('admin', {})).toThrow(/SEED_ADMIN_PASSWORD/)
    expect(() => requireSeedPassword('writer', { SEED_WRITER_PASSWORD: 'too-short' })).toThrow(/16 characters/)
    expect(requireSeedPassword('testingWorkspace', { TESTING_FIXTURE_PASSWORD: 'a-long-new-secret-value' })).toBe('a-long-new-secret-value')
  })

  it('the seed scripts never print a password and choose the hash through the local-database check', () => {
    const seed = readFileSync('prisma/seed.ts', 'utf8')
    expect(seed).not.toMatch(/console\.log\([^)]*\/ /) // the old "email / password" lines
    expect(seed).toContain('isLoopbackDatabase(process.env.DIRECT_URL)')
    expect(seed).toContain("update: localTarget ? { password: adminHash } : {}")
    const workspace = readFileSync('scripts/seed-testing-workspace.ts', 'utf8')
    expect(workspace).toContain('password: fixtureHash')
  })
})
