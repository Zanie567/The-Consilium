/** The ephemeral local storage service starts empty; clear only owned fixture references. */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { testDatabaseEnv } from './lib/testDatabase'
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseEnv().DATABASE_URL }) })
function owned(value: string | null, id: string) {
  try {
    const url = new URL(value ?? '')
    return ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.startsWith(`/storage/v1/object/public/avatars/${id}/`)
  } catch { return false }
}
async function main() {
  const marker = await db.siteSetting.findUnique({ where: { key: 'testing-workspace' } })
  if (!process.env.TESTING_WORKSPACE_ID || marker?.value !== process.env.TESTING_WORKSPACE_ID) throw new Error('Refusing unattested fixture reset.')
  const users = await db.user.findMany({ where: {
    emailVerified: { not: null },
    OR: [
      { testPersonaKey: { in: ['writer','writer-other','editor','editor-global','growth'] } },
      { email: { endsWith: '@tp.consilium.test' } },
      { email: { endsWith: '@lifecycle.consilium.test' } },
    ],
  }, include: { teamProfile: true } })
  for (const user of users) {
    if (owned(user.image, user.id)) await db.user.updateMany({ where: { id: user.id, image: user.image, testPersonaKey: user.testPersonaKey }, data: { image: null } })
    const card = user.teamProfile
    if (card && owned(card.image, user.id)) await db.teamMember.updateMany({ where: { id: card.id, userId: user.id, image: card.image }, data: { image: null } })
  }
  console.log('Only owned local avatar references of verified fixture personas reset; IDs, appointments and ownership preserved.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => db.$disconnect())
