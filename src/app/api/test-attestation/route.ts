import { prisma } from '@/lib/prisma'
import { assertRunDatabase } from '../../../../scripts/lib/assertRunDatabase'
export async function GET() {
  if (process.env.E2E_ISOLATED !== '1') return new Response(null, {status:404})
  assertRunDatabase()
  const rows = await prisma.$queryRaw<{database:string}[]>`SELECT current_database() AS database`
  return Response.json({ run: process.env.E2E_RUN_ID, database: rows[0].database })
}
