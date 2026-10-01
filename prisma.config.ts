import { defineConfig } from '@prisma/config'
import { config } from 'dotenv'
import { resolve } from 'path'
import { assertSafeTestDatabaseHost } from './scripts/lib/assertSafeTestDatabaseHost'

config({ path: resolve(process.cwd(), '.env.local') })

// scripts/setup-test-db.sh exports DATABASE_URL/DIRECT_URL itself and sets
// TEST_HARNESS=1 before invoking `prisma generate`/`db push` through this
// config — the dotenv call above never overrides an already-set env var, but
// this guard makes that precedence a hard requirement rather than an assumed
// default, for the one path (the test harness) that must never reach a
// hosted/production database.
if (process.env.TEST_HARNESS === '1') {
  assertSafeTestDatabaseHost(process.env.DIRECT_URL, 'DIRECT_URL (prisma.config.ts)')
}

export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL!,
  },
})
