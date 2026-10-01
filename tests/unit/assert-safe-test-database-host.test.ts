/**
 * Fail-closed guard the test harness must call before any destructive setup
 * step (schema push, seed, dedupe), so a misconfigured env can never let the
 * harness silently run against a hosted/production database.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'

afterEach(() => {
  delete process.env.TEST_DB_ALLOW_HOST
})

describe('assertSafeTestDatabaseHost', () => {
  it('allows localhost', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@localhost:5433/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('allows 127.0.0.1', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@127.0.0.1:5433/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('rejects an arbitrary remote host with no allow-list configured', () => {
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@db.example.com:5432/consilium', 'DATABASE_URL')
    ).toThrow(/neither localhost.*nor the host explicitly allow-listed/i)
  })

  it('allows a remote host that exactly matches TEST_DB_ALLOW_HOST', () => {
    process.env.TEST_DB_ALLOW_HOST = 'ci-postgres.internal'
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@ci-postgres.internal:5432/consilium', 'DATABASE_URL')
    ).not.toThrow()
  })

  it('rejects a Supabase pooler host even when it is not localhost', () => {
    expect(() =>
      assertSafeTestDatabaseHost(
        'postgresql://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
        'DATABASE_URL'
      )
    ).toThrow(/hosted.*Supabase.*production/i)
  })

  it('rejects a Supabase host even if someone tries to allow-list it', () => {
    process.env.TEST_DB_ALLOW_HOST = 'db.scllbuwkcqtmfogsgalt.supabase.co'
    expect(() =>
      assertSafeTestDatabaseHost('postgresql://postgres@db.scllbuwkcqtmfogsgalt.supabase.co:5432/postgres', 'DATABASE_URL')
    ).toThrow(/hosted.*Supabase.*production/i)
  })

  it('rejects a missing connection string with a clear message naming the label', () => {
    expect(() => assertSafeTestDatabaseHost(undefined, 'DIRECT_URL')).toThrow(/DIRECT_URL is not set/)
  })

  it('rejects an unparseable connection string', () => {
    expect(() => assertSafeTestDatabaseHost('not-a-url', 'DIRECT_URL')).toThrow(/not a valid connection URL/)
  })
})
