/** Read-only preview by default. --apply uses conditional updates in one transaction. */
import { PrismaClient, type Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import fs from 'node:fs'
import { publicAppointmentBackfill, type AppointmentSnapshot } from '../src/lib/publicAppointmentBackfill'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }) })
async function main() {
  if (!process.env.DIRECT_URL) throw new Error('Explicit DIRECT_URL is required; no dotenv fallback.')
  // to_jsonb allows a read-only preview before the additive column exists.
  const rows = await prisma.$queryRaw<AppointmentSnapshot[]>`SELECT tm.id, tm.name, tm.role, tm."order", tm."userId", to_jsonb(tm)->>'publicTier' AS "publicTier", u.role::text AS "permissionRole" FROM team_members tm LEFT JOIN users u ON u.id=tm."userId" ORDER BY tm."order", tm.id`
  const plan = publicAppointmentBackfill(rows)
  console.log(JSON.stringify(plan, null, 2))
  const planPath = process.argv.find(arg => arg.startsWith('--plan='))?.slice(7)
  if (!process.argv.includes('--apply') && planPath) fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })
  if (plan.ambiguous.length) throw new Error('Ambiguous records reported; no backfill applied.')
  if (process.argv.includes('--apply')) {
    if (!planPath) throw new Error('--apply requires the reviewed --plan=path from a prior preview.')
    const reviewed = JSON.parse(fs.readFileSync(planPath, 'utf8')) as ReturnType<typeof publicAppointmentBackfill>
    if (reviewed.version !== 1 || reviewed.ambiguous.length) throw new Error('Invalid or ambiguous reviewed plan.')
    const alreadyApplied = reviewed.rows.map(row => ({ ...row, publicTier: reviewed.changes.find(change => change.id === row.id)?.publicTier ?? row.publicTier }))
    if (JSON.stringify(rows) === JSON.stringify(alreadyApplied)) return
    if (JSON.stringify(plan) !== JSON.stringify(reviewed)) throw new Error('Roster changed since preview. Review a new plan; nothing applied.')
  }
  if (process.argv.includes('--apply')) await prisma.$transaction(async (tx) => {
    for (const change of plan.changes) {
      const original = rows.find((r) => r.id === change.id)!
      const updated = await tx.teamMember.updateMany({ where: {
        id: change.id, name: original.name, userId: original.userId, role: original.role,
        order: original.order, publicTier: null,
        ...(original.userId && original.permissionRole ? { user: { is: { role: original.permissionRole as Role } } } : {}),
      }, data: { publicTier: change.publicTier } })
      if (updated.count !== 1) throw new Error(`Card ${change.id} changed during review. Retry preview.`)
    }
  })
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
