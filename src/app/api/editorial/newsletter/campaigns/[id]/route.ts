/**
 * GET   /api/editorial/newsletter/campaigns/:id  detail, rendered preview and audit trail
 * PATCH /api/editorial/newsletter/campaigns/:id  { action, ... }
 *   edit     { subject?, previewText?, intro?, removeArticleIds? }   admins, editors, growth
 *            (article titles/summaries/links are the published article: refused if sent)
 *   rebuild                                                          admins, editors, growth
 *   cancel   { reason? }                                             admins, editors, growth
 *   approve  { expectedHash, scheduledFor? }  (approve = schedule the send)       admins only
 */
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { NEWSLETTER_APPROVE_ROLES, NEWSLETTER_EDIT_ROLES, NEWSLETTER_VIEW_ROLES } from '@/lib/rbac'
import { approveCampaign, cancelCampaign, rebuildCampaign, updateCampaignContent, type ContentPatch } from '@/lib/newsletter/campaigns'
import { campaignErrorResponse, readSmallJson, NO_STORE } from '@/lib/newsletter/http'
import { campaignDetail } from '@/lib/newsletter/overview'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireVerifiedSessionUser(NEWSLETTER_VIEW_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const detail = await campaignDetail(id, auth.user.role)
  if (!detail) return NextResponse.json({ error: 'Campaign not found.', code: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json(detail, { headers: NO_STORE })
}

export async function PATCH(request: Request, { params }: Params) {
  const body = await readSmallJson(request, 64 * 1024)
  const action = body?.action
  const roles = action === 'approve' ? NEWSLETTER_APPROVE_ROLES : NEWSLETTER_EDIT_ROLES
  const auth = await requireVerifiedSessionUser(roles)
  if (!auth.ok) return auth.response
  const { id } = await params
  const actor = { id: auth.user.id, name: auth.user.name }
  try {
    if (action === 'edit') {
      const patch: ContentPatch = {
        ...(body?.subject !== undefined ? { subject: body.subject as string } : {}),
        ...(body?.previewText !== undefined ? { previewText: body.previewText as string | null } : {}),
        ...(body?.intro !== undefined ? { intro: body.intro as string | null } : {}),
        ...(body?.summaries !== undefined ? { summaries: body.summaries } : {}),
        ...(Array.isArray(body?.removeArticleIds) ? { removeArticleIds: body.removeArticleIds as string[] } : {}),
      }
      await updateCampaignContent(id, actor, patch)
    } else if (action === 'rebuild') {
      await rebuildCampaign(id, actor)
    } else if (action === 'cancel') {
      await cancelCampaign(id, actor, body?.reason ?? null)
    } else if (action === 'approve') {
      await approveCampaign(id, actor, { expectedHash: body?.expectedHash, scheduledFor: body?.scheduledFor })
    } else {
      return NextResponse.json({ error: 'Unknown action.', code: 'INVALID' }, { status: 400 })
    }
    return NextResponse.json(await campaignDetail(id, auth.user.role), { headers: NO_STORE })
  } catch (error) {
    return campaignErrorResponse(error)
  }
}
