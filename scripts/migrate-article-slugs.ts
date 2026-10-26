/**
 * Approved migration of published article addresses, with permanent 301 redirects.
 * Runbook: docs/seo/article-url-migration.md. Logic: src/lib/articleSlugMigration.ts.
 *
 *   Dry run (read-only, the default):
 *     DIRECT_URL=... npx ts-node -P tsconfig.seed.json scripts/migrate-article-slugs.ts \
 *       --plan docs/seo/article-slug-migration-2026-10-24.json
 *
 *   Apply (one transaction; refuses unless the code printed by the dry run still matches):
 *     DIRECT_URL=... npx ts-node -P tsconfig.seed.json scripts/migrate-article-slugs.ts \
 *       --plan docs/seo/article-slug-migration-2026-10-24.json --apply --approve <code> --admin <admin email>
 *
 * DIRECT_URL must be given explicitly: .env.local is never read.
 */
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { applySlugMigration, checkSlugMigration, parseSlugMigrationPlan } from '../src/lib/articleSlugMigration'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  if (!process.env.DIRECT_URL) throw new Error('Explicit DIRECT_URL is required; no dotenv fallback.')
  const planPath = arg('plan')
  if (!planPath) throw new Error('--plan <path to the reviewed JSON mapping> is required.')
  const plan = parseSlugMigrationPlan(JSON.parse(fs.readFileSync(planPath, 'utf8')))
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
  try {
    const host = new URL(process.env.DIRECT_URL).hostname
    if (!process.argv.includes('--apply')) {
      const check = await checkSlugMigration(prisma, plan)
      console.log(`Database host: ${host}`)
      console.log(JSON.stringify(check, null, 2))
      if (!check.ok) {
        process.exitCode = 1
        console.error('\nDRY RUN FAILED: fix the problems above. Nothing was changed.')
        return
      }
      console.log(`\nDRY RUN OK. Nothing was changed. To apply exactly this plan against this database state:`)
      console.log(`  --apply --approve ${check.approvalCode} --admin <administrator email>`)
      return
    }
    const approvalCode = arg('approve')
    const adminEmail = arg('admin')
    if (!approvalCode || !adminEmail) throw new Error('--apply requires --approve <code from the dry run> and --admin <administrator email>.')
    const result = await applySlugMigration(prisma, plan, { approvalCode, adminEmail })
    console.log(`Database host: ${host}`)
    console.log(JSON.stringify(result, null, 2))
    console.log('\nAPPLIED. Old addresses now answer 301 (proxy cache: up to 60 s per server instance; the article page redirects immediately).')
    console.log('Public lists refresh within 30 s, the sitemap and RSS within 5 min. Then run the verification in the runbook.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
