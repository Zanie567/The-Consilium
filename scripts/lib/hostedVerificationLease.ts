import type { PrismaClient } from '@prisma/client'

/** Serialize operator checks that deliberately share seeded personas/profile cards.
 * Independent app sessions remain available. A killed operator's lease expires;
 * cleanup can remove only the exact capability this invocation acquired.
 */
export async function acquireHostedVerificationLease(db: PrismaClient, run: string) {
  const key = 'testing-hosted-browser-lease'
  const value = JSON.stringify({ run, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
  await db.$transaction(async tx => {
    // Transaction-scoped lock works through the Supabase transaction pooler.
    const lock = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`
    if (!lock[0]?.acquired) throw new Error('Another hosted verification is acquiring the persona lease; nothing changed.')
    const current = await tx.siteSetting.findUnique({ where: { key } })
    if (current) {
      if (typeof current.value !== 'string') throw new Error('Hosted verification lease is ambiguous; operator review required.')
      let previous: { run?: string; expiresAt?: string }
      try { previous = JSON.parse(current.value) }
      catch { throw new Error('Hosted verification lease is ambiguous; operator review required.') }
      if (!previous || typeof previous !== 'object') throw new Error('Hosted verification lease is ambiguous; operator review required.')
      const expires = Date.parse(previous.expiresAt ?? '')
      if (!previous.run || !Number.isFinite(expires)) throw new Error('Hosted verification lease is ambiguous; operator review required.')
      if (expires > Date.now()) throw new Error('Another hosted verification owns the shared test personas; nothing changed.')
      const updated = await tx.siteSetting.updateMany({ where: { key, value: current.value }, data: { value } })
      if (updated.count !== 1) throw new Error('Hosted verification lease changed; nothing changed.')
    } else await tx.siteSetting.create({ data: { key, value } })
  })
  return async () => {
    await db.siteSetting.deleteMany({ where: { key, value } })
  }
}
