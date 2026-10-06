import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertSafeTestDatabaseHost } from '../../scripts/lib/assertSafeTestDatabaseHost'
import { canonicalTagSlug } from '@/lib/tagIdentity'
const base = process.env.TEST_DATABASE_URL!
assertSafeTestDatabaseHost(base, 'TEST_DATABASE_URL')
const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8')
async function fixture(test: (client: Client) => Promise<void>) {
  const admin = new Client({ connectionString: base })
  await admin.connect()
  const name = `consilium_migration_${randomUUID().replaceAll('-', '')}`
  const url = new URL(base)
  url.pathname = `/${name}`
  let client: Client | undefined
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
    client = new Client({ connectionString: url.href })
    await client.connect()
    await client.query(
      'CREATE TABLE tags(id text PRIMARY KEY,name text NOT NULL,slug text UNIQUE); CREATE TABLE articles(id text PRIMARY KEY); CREATE TABLE article_tags("articleId" text REFERENCES articles(id),"tagId" text REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY("articleId","tagId")); CREATE TABLE subscribers(id text PRIMARY KEY,email text UNIQUE)'
    )
    await test(client)
  } finally {
    await client?.end()
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
}
describe('upgrade migrations on isolated empty/colliding historical databases', () => {
  it('applies all additive migrations on empty tables and keeps client/DB canonical identity equal', async () =>
    fixture(async (client) => {
      for (const file of [
        '20261006153514_discovery_topic_identity',
        '20261006160355_managed_article_images',
        '20261006161413_normalized_subscriber_email',
        '20261006161505_article_active_engagement',
      ])
        await client.query(migration(file))
      for (const label of [
        ' Investment & Finance ',
        'INVESTMENT---FINANCE',
        'Ｆｉｎａｎｃｅ',
        'Économie',
        'İnflation',
        'ΟΣ',
        '中文',
      ]) {
        const result = await client.query('SELECT public.consilium_tag_identity($1) AS slug', [
          label,
        ])
        expect(result.rows[0].slug, label).toBe(canonicalTagSlug(label))
      }
      expect(
        (
          await client.query(
            "SELECT count(*) FROM pg_policies WHERE tablename IN ('article_image_assets','article_engagement_sessions')"
          )
        ).rows[0].count
      ).toBe('0')
    }))
  it('refuses canonical tag collisions without rewriting IDs, slugs or relations', async () =>
    fixture(async (client) => {
      await client.query(
        "INSERT INTO tags VALUES ('one','Finance & Policy','old-one'),('two',' FINANCE POLICY ','old-two'); INSERT INTO articles VALUES ('article'); INSERT INTO article_tags VALUES ('article','one')"
      )
      await expect(
        client.query(migration('20261006153514_discovery_topic_identity'))
      ).rejects.toThrow('duplicate canonical names')
      await client.query('ROLLBACK')
      expect((await client.query('SELECT id,slug FROM tags ORDER BY id')).rows).toEqual([
        { id: 'one', slug: 'old-one' },
        { id: 'two', slug: 'old-two' },
      ])
      expect((await client.query('SELECT count(*) FROM article_tags')).rows[0].count).toBe('1')
    }))
  it('refuses historical case/whitespace duplicate subscribers without data deletion', async () =>
    fixture(async (client) => {
      await client.query(
        "INSERT INTO subscribers VALUES ('one','Reader@example.test'),('two',' reader@example.test ')"
      )
      await expect(
        client.query(migration('20261006161413_normalized_subscriber_email'))
      ).rejects.toThrow('canonical duplicates')
      await client.query('ROLLBACK')
      expect((await client.query('SELECT count(*) FROM subscribers')).rows[0].count).toBe('2')
    }))
})
