import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { testDatabaseEnv } from '../../scripts/lib/testDatabase'
import { acquireHostedVerificationLease } from '../../scripts/lib/hostedVerificationLease'

// Exercise the operator lease against guarded LOCAL SQL, including real races.
// This never connects the automated test harness to a hosted project.
const connectionString = testDatabaseEnv().DATABASE_URL
const schema = `operator_lease_${randomUUID().replaceAll('-', '')}`
const sql = new Client({ connectionString })
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) })
const key = 'testing-hosted-browser-lease'
beforeAll(async () => {
  await sql.connect()
  await sql.query(`CREATE SCHEMA "${schema}"`)
  await sql.query(`CREATE TABLE "${schema}".site_settings (key text PRIMARY KEY,value text,"updatedAt" timestamp NOT NULL DEFAULT now(),"updatedBy" text)`)
  await db.siteSetting.create({ data: { key: 'unrelated-appointment-setting', value: 'retain' } })
})
beforeEach(async () => { await db.siteSetting.deleteMany({ where: { key } }) })
afterAll(async () => {
  expect((await db.siteSetting.findUniqueOrThrow({ where: { key: 'unrelated-appointment-setting' } })).value).toBe('retain')
  await db.$disconnect()
  await sql.query(`DROP SCHEMA "${schema}" CASCADE`)
  await sql.end()
})

it('only one concurrent operator can own the shared persona resources', async () => {
  const attempts = await Promise.allSettled([acquireHostedVerificationLease(db, 'first'), acquireHostedVerificationLease(db, 'second')])
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect(await db.siteSetting.count({ where: { key } })).toBe(1)
  for (const result of attempts) if (result.status === 'fulfilled') await result.value()
  expect(await db.siteSetting.count({ where: { key } })).toBe(0)
})

it('rejects an active owner and permits repeatable setup after scoped release', async () => {
  const release = await acquireHostedVerificationLease(db, 'current')
  await expect(acquireHostedVerificationLease(db, 'competing')).rejects.toThrow('Another hosted verification')
  await release()
  await release()
  const next = await acquireHostedVerificationLease(db, 'next')
  await next()
})

it('an expired invocation cannot remove a replacement invocation lease', async () => {
  const oldRelease = await acquireHostedVerificationLease(db, 'old')
  await db.siteSetting.update({ where: { key }, data: { value: JSON.stringify({ run: 'old', expiresAt: new Date(0).toISOString() }) } })
  const newRelease = await acquireHostedVerificationLease(db, 'new')
  await oldRelease()
  expect(JSON.parse((await db.siteSetting.findUniqueOrThrow({ where: { key } })).value!).run).toBe('new')
  await newRelease()
})

it.each([null, '{invalid', JSON.stringify({ run: 'unknown', expiresAt: 'invalid' })])('reports ambiguous state without overwriting it: %s', async value => {
  await db.siteSetting.create({ data: { key, value } })
  await expect(acquireHostedVerificationLease(db, 'new')).rejects.toThrow('ambiguous')
  expect((await db.siteSetting.findUniqueOrThrow({ where: { key } })).value).toBe(value)
})
