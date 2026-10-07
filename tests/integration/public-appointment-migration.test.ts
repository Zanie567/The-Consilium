import { it, expect } from 'vitest'
import { Client } from 'pg'
import fs from 'node:fs'
import { testDatabaseEnv } from '../../scripts/lib/testDatabase'

it('additive migration preserves upgrade ownership and is repeatable on an empty schema', async () => {
  const client = new Client({ connectionString: testDatabaseEnv().DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const schema = `migration_${Date.now()}`
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
    await client.query('CREATE TABLE users(id text PRIMARY KEY, role text); CREATE TABLE team_members(id text PRIMARY KEY, "userId" text UNIQUE REFERENCES users(id), role text, "order" int, image text, bio text)')
    const sql = fs.readFileSync('supabase/migrations/20261003231314_public_appointments_testing_sessions.sql', 'utf8').replace(/^BEGIN;|^COMMIT;/gm, '')
    // Upgrade: populate the actual previous column set before applying the SQL.
    await client.query(`INSERT INTO users VALUES ('owner', 'ADMIN'); INSERT INTO team_members(id,"userId",role,"order",image,bio) VALUES ('original','owner','Editor-in-Chief',1,'old-photo','old-bio')`)
    const before = (await client.query('SELECT * FROM team_members')).rows
    await client.query(sql)
    expect((await client.query('SELECT * FROM team_members')).rows).toEqual(before.map(row => ({ ...row, publicTier: null })))
    await client.query(sql)
    expect((await client.query('SELECT * FROM team_members')).rows).toEqual(before.map(row => ({ ...row, publicTier: null })))
    await expect(client.query(`INSERT INTO team_members(id,"userId",role) VALUES ('duplicate','owner','Writer')`)).rejects.toMatchObject({ code: '23505' })
  } finally { await client.query('ROLLBACK'); await client.end() }
})

it('applies to empty previous-schema tables and installs session RLS', async () => {
  const client = new Client({ connectionString: testDatabaseEnv().DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const schema = `fresh_migration_${Date.now()}`
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
    await client.query('CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE team_members(id text PRIMARY KEY, "userId" text UNIQUE REFERENCES users(id))')
    const sql = fs.readFileSync('supabase/migrations/20261003231314_public_appointments_testing_sessions.sql', 'utf8').replace(/^BEGIN;|^COMMIT;/gm, '')
    await client.query(sql)
    expect((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='testing_sessions'::regclass")).rows[0].relrowsecurity).toBe(true)
    expect((await client.query('SELECT count(*)::int AS count FROM team_members')).rows[0].count).toBe(0)
  } finally { await client.query('ROLLBACK'); await client.end() }
})
