/**
 * Prints `export` lines for the verified test database, for the bash scripts:
 *   eval "$(npx ts-node -P tsconfig.seed.json scripts/test-db-env.ts)"
 * Exits non-zero (printing nothing to eval) if the database is not safe.
 */
import { testDatabaseEnv } from './lib/testDatabase'

try {
  for (const [key, value] of Object.entries(testDatabaseEnv())) {
    process.stdout.write(`export ${key}='${value.replace(/'/g, `'\\''`)}'\n`)
  }
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`)
  process.exit(1)
}
