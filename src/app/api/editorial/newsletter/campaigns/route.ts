/**
 * GET  /api/editorial/newsletter/campaigns  overview: campaigns, switches, audience counts (no addresses)
 * POST /api/editorial/newsletter/campaigns  { action: 'build_weekly' }: build this week's edition now (draft)
 */
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { NEWSLETTER_EDIT_ROLES, NEWSLETTER_VIEW_ROLES } from '@/lib/rbac'
import { ensureWeeklyEdition } from '@/lib/newsletter/campaigns'
import { campaignErrorResponse, readSmallJson, NO_STORE } from '@/lib/newsletter/http'
import { campaignSummary, newsletterOverview } from '@/lib/newsletter/overview'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireVerifiedSessionUser(NEWSLETTER_VIEW_ROLES)
  if (!auth.ok) return auth.response
  return NextResponse.json(await newsletterOverview(auth.user.role), { headers: NO_STORE })
}

export async function POST(request: Request) {
  const auth = await requireVerifiedSessionUser(NEWSLETTER_EDIT_ROLES)
  if (!auth.ok) return auth.response
  const body = await readSmallJson(request)
  if (body?.action !== 'build_weekly') return NextResponse.json({ error: 'Unknown action.', code: 'INVALID' }, { status: 400 })
  try {
    const result = await ensureWeeklyEdition(new Date(), { id: auth.user.id, name: auth.user.name }, { force: true })
    if (result.state === 'not_due') return NextResponse.json({ error: 'Not due.', code: 'NOT_DUE' }, { status: 409 })
    return NextResponse.json({ state: result.state, campaign: campaignSummary(result.campaign) }, { status: result.state === 'created' ? 201 : 200, headers: NO_STORE })
  } catch (error) {
    return campaignErrorResponse(error)
  }
}
