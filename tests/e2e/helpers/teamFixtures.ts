/**
 * Fixture data for the Team Profile E2E spec. Writes to the database, so it refuses
 * to run unless DATABASE_URL (pinned by playwright.config.ts) is a verified local
 * test database. The legacy cards mirror the SHAPE of production's ten cards
 * (titles, order, static /team photos, no emails) as reconciled on 2026-10-01.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { assertSafeTestDatabaseHost } from '../../../scripts/lib/assertSafeTestDatabaseHost'

export const PASSWORD = 'tp-pass-1234'
const DOMAIN = '@tp.consilium.test'
export const email = (key: string) => `${key}${DOMAIN}`

const ACCOUNTS = {
  writer: { name: 'Wendy Writer', role: 'WRITER' },
  editor: { name: 'Edgar Editor', role: 'EDITOR' },
  growth: { name: 'Grace Growth', role: 'GROWTH' },
  reader: { name: 'Rita Reader', role: 'READER' },
  admin: { name: 'Ada Admin', role: 'ADMIN' },
  /** Has an unlinked legacy card with the same name and NO email (the production case). */
  legacy: { name: 'Lena Legacy', role: 'EDITOR' },
  /** Has an unlinked legacy card carrying their email — adopted on first save. */
  adopt: { name: 'Alan Adopt', role: 'WRITER' },
  /** Already linked to a card (edit state). */
  linked: { name: 'Linda Linked', role: 'EDITOR' },
  /** The Editor-in-Chief, with ADMIN permission and a trusted masthead appointment. */
  chief: { name: 'Alexander Escala', role: 'ADMIN' },
  /** A second chief appointment on a WRITER account; title/order decide placement. */
  mismatch: { name: 'Mira Mismatch', role: 'WRITER' },
  noname: { name: null, role: 'WRITER' },
} as const

export type AccountKey = keyof typeof ACCOUNTS

/** Production-shaped legacy cards: [name, title, order, photo, linked account key]. */
const PRODUCTION_SHAPED: [string, string, number, string, AccountKey | null][] = [
  ['Alexander Escala', 'Editor-in-Chief', 1, '/team/alexander-escala.png', 'chief'],
  ['Lucas Dwyer', '', 2, '/team/lucas-dwyer.jpeg', null],
  ['Satvik Singla', 'Senior Editor', 3, '/team/satvik-singla.jpeg', null],
  ['Julia Stepniak', 'Chief Designer', 4, '/team/julia-stepniak.jpeg', null],
  ['Annika Sarawgi', 'Senior Editor', 5, '/team/annika-sarawgi.png', null],
  ['Sam Hunt', 'Junior Editor', 6, '/team/sam-hunt.png', null],
  ['Zara Spendiff', 'Writer', 7, '/team/zara-spendiff.png', null],
  ['Gurmehar Kaur', 'Writer', 8, '/team/gurmehar-kaur.png', null],
  ['Yaoqing Wang', 'Writer', 9, '/team/yaoqing-wang.jpeg', null],
  ['Catherine Toh', 'Writer', 10, '/team/catherine-toh.png', null],
]

let prisma: PrismaClient | null = null
export function db(): PrismaClient {
  if (!prisma) {
    const url = process.env.DATABASE_URL ?? ''
    assertSafeTestDatabaseHost(url, 'DATABASE_URL')
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  }
  return prisma
}

export async function closeDb() {
  await prisma?.$disconnect().catch(() => {})
  prisma = null
}

/** Rebuilds every team fixture from scratch. */
export async function resetTeamFixtures() {
  const client = db()
  await client.teamMember.deleteMany({ where: { OR: [{ id: { startsWith: 'tp-fixture-' } }, { id: { startsWith: 'seed-team-' } }, { user: { email: { endsWith: DOMAIN } } }] } })
  await client.user.deleteMany({ where: { email: { endsWith: DOMAIN } } })

  const password = await bcrypt.hash(PASSWORD, 10)
  const ids = {} as Record<AccountKey, string>
  for (const [key, account] of Object.entries(ACCOUNTS) as [AccountKey, (typeof ACCOUNTS)[AccountKey]][]) {
    const user = await client.user.create({
      data: { email: email(key), name: account.name, role: account.role, password, emailVerified: new Date() },
    })
    ids[key] = user.id
  }

  for (const [name, title, order, image, account] of PRODUCTION_SHAPED) {
    await client.teamMember.create({
      data: {
        id: `tp-fixture-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        role: title,
        ...(name === 'Lucas Dwyer' ? { publicTier: 'leadership' } : {}),
        order,
        image,
        bio: name === 'Lucas Dwyer' ? null : `${name} writes for The Consilium.`,
        userId: account ? ids[account] : null,
      },
    })
  }

  // The "production case": a person with a card and an account, but nothing linking them.
  await client.teamMember.create({
    data: { id: 'tp-fixture-legacy', name: 'Lena Legacy', role: 'Senior Editor', order: 20, image: '/team/sam-hunt.png', bio: 'Lena’s admin-entered bio.' },
  })
  // Linkable by email.
  await client.teamMember.create({
    data: { id: 'tp-fixture-adopt', name: 'Some Old Spelling', role: 'Writer', order: 21, bio: 'Alan’s old bio.', email: email('adopt') },
  })
  // Appointment is independent of the account permission.
  await client.teamMember.create({
    data: { name: 'Mira Mismatch', role: 'Editor-in-Chief', order: 23, bio: 'Mira’s bio.', userId: ids.mismatch },
  })
  // Already linked.
  await client.teamMember.create({
    data: { name: 'Linda Linked', role: 'Junior Editor', order: 22, bio: 'Linda’s existing bio.', userId: ids.linked, image: '/team/annika-sarawgi.png' },
  })
  return ids
}
