import { defineConfig } from 'vitest/config'
import path from 'path'

// Only for scripts/db/data-api-harness.sh, which owns a disposable local Supabase stack.
// The default config excludes tests/data-api, so `npm test` never collects these.
if (process.env.DATA_API_HARNESS !== '1') {
  throw new Error('tests/data-api runs only through scripts/db/data-api-harness.sh')
}
for (const name of ['DATA_API_DB_URL', 'DATA_API_URL']) {
  const host = new URL(process.env[name] ?? 'invalid:').hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing ${name} on ${host || 'an invalid URL'}: data API tests are local only`)
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/data-api/**/*.test.ts'],
    // The files share one database and change its policies, so they run in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
