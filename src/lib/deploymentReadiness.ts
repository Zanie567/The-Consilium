import type { PrismaClient } from '@prisma/client'
export async function deploymentReadiness(db: Pick<PrismaClient, '$queryRaw'>, env: Record<string, string | undefined> = process.env) {
  const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','team_members','testing_sessions')`
  const present = new Set(columns.map(c => `${c.table_name}.${c.column_name}`))
  const required = ['team_members.userId', 'team_members.publicTier', 'users.testPersonaKey', 'users.testingRevision', 'testing_sessions.id', 'testing_sessions.tokenHash', 'testing_sessions.administratorId', 'testing_sessions.personaId', 'testing_sessions.revision', 'testing_sessions.createdAt', 'testing_sessions.expiresAt', 'testing_sessions.stoppedAt', 'testing_sessions.stopReason']
  const gaps = required.filter(c => !present.has(c)).map(c => `Missing schema: ${c}`)
  try {
    const storage = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    if (!['http:', 'https:'].includes(storage.protocol) || storage.username || storage.password) throw new Error()
  } catch { gaps.push('Storage endpoint is missing or invalid') }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) gaps.push('Server storage credential is missing')
  const indexes = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='team_members'`
  if (!indexes.some(i => /UNIQUE.*\("userId"\)/.test(i.indexdef))) gaps.push('Missing one-card-per-account unique index')
  const tables = await db.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.testing_sessions')`
  if (!tables[0]?.relrowsecurity) gaps.push('Testing session row-level security is missing')
  try {
    const buckets = await db.$queryRaw<{ id: string; public: boolean; file_size_limit: bigint | null; allowed_mime_types: string[] | null }[]>`SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id IN ('avatars','article-images')`
    for (const id of ['avatars', 'article-images']) {
      const bucket = buckets.find(b => b.id === id)
      if (!bucket?.public) gaps.push(`Missing public storage bucket: ${id}`)
      if (id === 'avatars' && bucket && (Number(bucket.file_size_limit) !== 5242880 || !['image/jpeg','image/png','image/gif','image/webp','image/avif'].every(t => bucket.allowed_mime_types?.includes(t)))) gaps.push('avatars limits/MIME configuration differs from profile upload contract')
    }
  } catch { gaps.push('Storage bucket configuration cannot be read') }
  return { healthy: gaps.length === 0, gaps }
}
