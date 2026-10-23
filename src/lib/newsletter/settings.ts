import { prisma } from '@/lib/prisma'

/**
 * Newsletter switches, stored in site_settings. Both fail closed:
 *   - paused unless the row says exactly 'false' (a missing row, a read error or any other value = paused);
 *   - weekly auto-send only when the row says exactly 'true'.
 * Every change is written to audit_logs by the caller.
 */
export const PAUSE_SETTING_KEY = 'newsletter.paused'
export const AUTO_SEND_SETTING_KEY = 'newsletter.weekly.autoSend'

type Db = Pick<typeof prisma, 'siteSetting'>

export async function isNewsletterPaused(db: Db = prisma): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: PAUSE_SETTING_KEY }, select: { value: true } })
    return row?.value !== 'false'
  } catch {
    return true
  }
}

export async function isWeeklyAutoSendEnabled(db: Db = prisma): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: AUTO_SEND_SETTING_KEY }, select: { value: true } })
    return row?.value === 'true'
  } catch {
    return false
  }
}

export async function writeSetting(db: Db, key: string, value: string, actorId: string): Promise<void> {
  await db.siteSetting.upsert({
    where: { key },
    create: { key, value, updatedBy: actorId },
    update: { value, updatedBy: actorId },
  })
}
