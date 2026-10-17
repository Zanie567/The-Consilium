import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { prisma, hash } = vi.hoisted(() => ({
  prisma: {
    category: { upsert: vi.fn() },
    user: { upsert: vi.fn() },
    article: { upsert: vi.fn(), deleteMany: vi.fn() },
    teamMember: { findUnique: vi.fn(), upsert: vi.fn() },
    $disconnect: vi.fn(),
  },
  hash: vi.fn(),
}))

vi.mock('dotenv', () => ({ config: vi.fn() }))
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor() { return prisma } } }))
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }))
vi.mock('bcryptjs', () => ({ default: { hash } }))
vi.mock('../../scripts/lib/assertSafeTestDatabaseHost', () => ({ assertSeedTargetIsSafe: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('DIRECT_URL', 'postgresql://postgres@db.example.com/seed-test')
  vi.stubEnv('SEED_ADMIN_PASSWORD', 'new-admin-password-1234')
  vi.stubEnv('SEED_WRITER_PASSWORD', 'new-writer-password-1234')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  hash.mockImplementation(async (value: string) => `hashed:${value}`)
  prisma.category.upsert.mockResolvedValue({ id: 'category', name: 'Category' })
  prisma.user.upsert.mockResolvedValue({ id: 'user', email: 'fixture@example.com' })
  prisma.article.upsert.mockResolvedValue({ title: 'Article' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function runSeed() {
  await import('../../prisma/seed')
  await vi.waitFor(() => expect(prisma.$disconnect).toHaveBeenCalledOnce())
}

describe('main seed credential preflight', () => {
  it.each([
    ['SEED_ADMIN_PASSWORD', ''],
    ['SEED_ADMIN_PASSWORD', 'too-short'],
    ['SEED_WRITER_PASSWORD', ''],
    ['SEED_WRITER_PASSWORD', 'too-short'],
  ])('rejects invalid %s (%s) before any database write', async (variable, value) => {
    vi.stubEnv(variable, value)
    await runSeed()
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(variable) }))
    expect(prisma.category.upsert).not.toHaveBeenCalled()
    expect(prisma.user.upsert).not.toHaveBeenCalled()
    expect(prisma.article.upsert).not.toHaveBeenCalled()
    expect(prisma.article.deleteMany).not.toHaveBeenCalled()
    expect(prisma.teamMember.upsert).not.toHaveBeenCalled()
    expect(hash).not.toHaveBeenCalled()
  })

  it.each([false, true])('uses the resolved passwords and preserves account updates (local: %s)', async (local) => {
    if (local) {
      vi.stubEnv('DIRECT_URL', 'postgresql://postgres@localhost/seed-test')
      vi.stubEnv('SEED_ADMIN_PASSWORD', '')
      vi.stubEnv('SEED_WRITER_PASSWORD', '')
    }
    await runSeed()
    const adminHash = `hashed:${local ? 'consilium2024' : 'new-admin-password-1234'}`
    const writerHash = `hashed:${local ? 'writer2024' : 'new-writer-password-1234'}`
    expect(process.exit).not.toHaveBeenCalled()
    expect(hash).toHaveBeenCalledTimes(2)
    expect(prisma.user.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      update: local ? { password: adminHash } : {},
      create: expect.objectContaining({ password: adminHash }),
    }))
    expect(prisma.user.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      update: {},
      create: expect.objectContaining({ password: writerHash }),
    }))
  })
})
