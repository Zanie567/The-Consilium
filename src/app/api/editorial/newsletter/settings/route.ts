/**
 * PUT /api/editorial/newsletter/settings { paused?, autoSend? }
 *   pause (paused: true)        admins and editors: a safety brake
 *   unpause / weekly auto-send  admins only
 */
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NEWSLETTER_APPROVE_ROLES, NEWSLETTER_PAUSE_ROLES } from '@/lib/rbac'
import { readSmallJson, NO_STORE } from '@/lib/newsletter/http'
import { AUTO_SEND_SETTING_KEY, PAUSE_SETTING_KEY, isNewsletterPaused, isWeeklyAutoSendEnabled, writeSetting } from '@/lib/newsletter/settings'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const body = await readSmallJson(request)
  const pausing = body?.paused === true && body.autoSend === undefined
  if (!body || (typeof body.paused !== 'boolean' && typeof body.autoSend !== 'boolean')) {
    return NextResponse.json({ error: 'Nothing to change.', code: 'INVALID' }, { status: 400 })
  }
  const auth = await requireVerifiedSessionUser(pausing ? NEWSLETTER_PAUSE_ROLES : NEWSLETTER_APPROVE_ROLES)
  if (!auth.ok) return auth.response
  await prisma.$transaction(async (tx) => {
    if (typeof body.paused === 'boolean') {
      await writeSetting(tx, PAUSE_SETTING_KEY, body.paused ? 'true' : 'false', auth.user.id)
      await tx.auditLog.create({ data: { action: body.paused ? 'newsletter.settings.paused' : 'newsletter.settings.unpaused', targetId: PAUSE_SETTING_KEY, targetType: 'site_setting', performedBy: auth.user.id } })
    }
    if (typeof body.autoSend === 'boolean') {
      await writeSetting(tx, AUTO_SEND_SETTING_KEY, body.autoSend ? 'true' : 'false', auth.user.id)
      await tx.auditLog.create({ data: { action: body.autoSend ? 'newsletter.settings.auto_send_on' : 'newsletter.settings.auto_send_off', targetId: AUTO_SEND_SETTING_KEY, targetType: 'site_setting', performedBy: auth.user.id } })
    }
  })
  return NextResponse.json({ paused: await isNewsletterPaused(), autoSend: await isWeeklyAutoSendEnabled() }, { headers: NO_STORE })
}
