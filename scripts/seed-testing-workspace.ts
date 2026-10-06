/** Scoped, repeatable fixtures on a guarded database. Never imports dotenv. */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { testDatabaseEnv } from './lib/testDatabase'
const { DATABASE_URL } = testDatabaseEnv()
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
async function main() {
  const workspace = process.env.TESTING_WORKSPACE_ID ?? 'local-consilium-testing'
  const password = await bcrypt.hash('testing-local-1234', 10)
  const definitions = [
    ['testing-admin@consilium.test', 'Testing Administrator', 'ADMIN', null],
    ['writer@theconsilium.com', 'Test Writer', 'WRITER', 'writer'],
    ['test-other-writer@consilium.test', 'Other Writer', 'WRITER', 'writer-other'],
    ['editor.opinion@consilium.test', 'Opinion Editor', 'EDITOR', 'editor'],
    ['editor.global@consilium.test', 'Global Editor', 'EDITOR', 'editor-global'],
    ['growth@consilium.test', 'Growth', 'GROWTH', 'growth'],
  ] as const
  await prisma.$transaction(async (tx) => {
    // Serialize standalone seeds too. A conflict must leave no partial fixtures.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(677201031)`
    const existingMarker = await tx.siteSetting.findUnique({ where: { key: 'testing-workspace' } })
    if (existingMarker?.value && existingMarker.value !== workspace) throw new Error('Workspace identity conflict.')
    // Existing workflow fixtures are dedicated accounts in this isolated database.
    for (const [email, name, role, key] of definitions) {
      const existing = await tx.user.findUnique({ where: { email } })
      if (existing && (existing.role !== role || (existing.testPersonaKey && existing.testPersonaKey !== key))) throw new Error(`Fixture conflict for ${email}; refusing to repurpose an account.`)
      await tx.user.upsert({ where: { email }, update: { testPersonaKey: key, emailVerified: new Date() }, create: { email, name, role, testPersonaKey: key, emailVerified: new Date(), password } })
    }
    await tx.siteSetting.upsert({ where: { key: 'testing-workspace' }, update: {}, create: { key: 'testing-workspace', value: workspace } })
  })
  console.log('Testing personas verified; workspace attested. Existing appointments and passwords preserved.')
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
