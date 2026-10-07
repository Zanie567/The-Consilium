import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { queueArticleImageCleanup } from '@/lib/articleImageStorage'
import { withTestingAudit } from '@/lib/testingAudit'
/** Beacon-compatible normal-exit cleanup. Cannot remove saved/shared images. */
async function POSTHandler(request: Request) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return auth.response
  try {
    const { urls } = await request.json()
    if (
      !Array.isArray(urls) ||
      urls.length > 20 ||
      urls.some((url) => typeof url !== 'string' || url.length > 2000)
    )
      return NextResponse.json({ error: 'Invalid image cleanup request.' }, { status: 400 })
    for (const url of new Set<string>(urls)) await queueArticleImageCleanup(url, auth.user.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'Image cleanup is temporarily unavailable.' },
      { status: 503 }
    )
  }
}

export const POST = withTestingAudit(POSTHandler)
