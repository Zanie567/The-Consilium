import { assertSafeTestDatabaseHost } from './lib/assertSafeTestDatabaseHost'

assertSafeTestDatabaseHost(process.env.DATABASE_URL, 'DATABASE_URL')
assertSafeTestDatabaseHost(process.env.DIRECT_URL, 'DIRECT_URL')

console.log(`   ok: ${new URL(process.env.DATABASE_URL!).hostname}`)
