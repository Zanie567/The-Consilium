/** Reviewed resources provisioned independently of the destructive test harness. */
export const HOSTED_TEST_WORKSPACE = {
  projectRef: 'zrieajoqosgzyesfatta',
  storageOrigin: 'https://zrieajoqosgzyesfatta.supabase.co',
  siteOrigin: 'https://consilium-testing.vercel.app',
  poolerHost: 'aws-0-eu-west-1.pooler.supabase.com',
  databaseRole: 'consilium_testing',
  workspaceId: 'consilium-testing-zrieajoqosgzyesfatta',
} as const

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'] as const

/**
 * Public storage buckets the hosted workspace needs, with the limits it was provisioned with.
 * `deploymentReadiness` checks presence (and the avatar limits) after the fact; the operator plan
 * creates them from this list so a recreated project does not depend on hand-made configuration.
 */
export const HOSTED_TEST_BUCKETS = [
  { id: 'article-images', fileSizeLimit: 10_485_760, mimeTypes: IMAGE_TYPES },
  { id: 'avatars', fileSizeLimit: 5_242_880, mimeTypes: IMAGE_TYPES },
] as const

/** Idempotent, additive SQL: creates a missing bucket, never alters or removes an existing one. */
export function hostedBucketSql(): string {
  const rows = HOSTED_TEST_BUCKETS.map(b => `('${b.id}','${b.id}',true,${b.fileSizeLimit},ARRAY[${b.mimeTypes.map(t => `'${t}'`).join(',')}]::text[])`).join(',\n ')
  return `INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES\n ${rows}\nON CONFLICT (id) DO NOTHING;`
}

export function hostedTestingConfigurationError(env: Record<string, string | undefined>): string | null {
  const w = HOSTED_TEST_WORKSPACE
  if (env.TEST_HARNESS === '1' || env.E2E_ISOLATED === '1' || env.TEST_DATABASE_URL) return 'Hosted interactive testing cannot use the automated test harness.'
  if (env.TESTING_WORKSPACE_ID !== w.workspaceId || env.NEXT_PUBLIC_SUPABASE_URL !== w.storageOrigin || env.NEXTAUTH_URL !== w.siteOrigin || env.NEXT_PUBLIC_SITE_URL !== w.siteOrigin) return 'Hosted testing resources do not match the reviewed workspace.'
  if (env.DATABASE_URL !== env.DIRECT_URL) return 'Hosted testing requires the reviewed database connection for both clients.'
  try {
    const db = new URL(env.DATABASE_URL ?? '')
    if (db.protocol !== 'postgresql:' || db.hostname !== w.poolerHost || db.port !== '6543' || db.pathname !== '/postgres' || decodeURIComponent(db.username) !== `${w.databaseRole}.${w.projectRef}` || !db.password || db.searchParams.get('sslmode') !== 'verify-full' || [...db.searchParams.keys()].some(key => key !== 'sslmode')) throw new Error()
  } catch { return 'Hosted testing database is not the verified project connection.' }
  if (env.EMAIL_TRANSPORT !== 'capture-db' || env.OUTBOUND_INTEGRATIONS_DISABLED !== '1' || env.RESEND_API_KEY || env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.FRED_API_KEY || env.ALPHA_VANTAGE_API_KEY) return 'Hosted testing requires database email capture and explicitly disabled outbound integrations.'
  return null
}
