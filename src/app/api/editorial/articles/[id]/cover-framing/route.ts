import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ARTICLE_MUTATION_ROLES } from '@/lib/rbac'
import { editorCanAccessArticleCategory } from '@/lib/articleCategoryAccess'
import { prisma } from '@/lib/prisma'
import { withTestingAudit } from '@/lib/testingAudit'
import {
  coverFramingKey, parseCoverFraming,
  validateCoverFraming, writerMayFrameCover,
} from '@/lib/coverFraming'

export const dynamic = 'force-dynamic'

interface Context { params: Promise<{ id: string }> }

async function authorise(id: string) {
  const auth = await requireVerifiedSessionUser(ARTICLE_MUTATION_ROLES)
  if (!auth.ok) return { ok: false as const, response: auth.response }
  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, authorId: true, status: true, deletedAt: true, categoryId: true, coverImage: true, slug: true },
  })
  if (!article || article.deletedAt) {
    return { ok: false as const, response: NextResponse.json({ error: 'Article not found.' }, { status: 404 }) }
  }
  if (auth.user.role === 'WRITER' && !writerMayFrameCover(article.authorId, article.status, auth.user.id)) {
    return { ok: false as const, response: NextResponse.json({
      error: 'Writers can adjust cover framing only on their own editable drafts. Ask an editor to change a published cover.',
    }, { status: 403 }) }
  }
  if (auth.user.role === 'EDITOR' &&
    !(await editorCanAccessArticleCategory(auth.user.id, article.categoryId))) {
    return { ok: false as const, response: NextResponse.json({
      error: 'This article is outside your assigned categories.',
    }, { status: 403 }) }
  }
  return { ok: true as const, user: auth.user, article }
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  const access = await authorise(id)
  if (!access.ok) return access.response
  try {
    const setting = await prisma.siteSetting.findUnique({
      where: { key: coverFramingKey(id) },
      select: { value: true },
    })
    return NextResponse.json({
      framing: parseCoverFraming(setting?.value, access.article.coverImage ?? ''),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to read cover framing.' }, { status: 503 })
  }
}

async function PATCHHandler(request: Request, { params }: Context) {
  const { id } = await params
  const access = await authorise(id)
  if (!access.ok) return access.response
  let submitted = null
  try {
    submitted = validateCoverFraming(await request.json())
  } catch {
    // Invalid JSON is never accepted.
  }
  if (!submitted) {
    return NextResponse.json({ error: 'Invalid framing: use Fit/Fill, 100–200% zoom and a valid focus point.' }, { status: 400 })
  }
  if (!access.article.coverImage || submitted.imageUrl !== access.article.coverImage) {
    return NextResponse.json({ error: 'The cover image has changed. Reload its framing before saving.' }, { status: 409 })
  }
  try {
    await prisma.siteSetting.upsert({
      where: { key: coverFramingKey(id) },
      create: { key: coverFramingKey(id), value: JSON.stringify(submitted), updatedBy: access.user.id },
      update: { value: JSON.stringify(submitted), updatedBy: access.user.id },
    })
    // An invalidation failure must not turn an already committed setting into a
    // false save failure. Warn explicitly if a published page could stay stale.
    let cacheRefreshed = true
    try {
      revalidatePath(`/articles/${access.article.slug}`)
    } catch (error) {
      cacheRefreshed = false
      console.error('[cover-framing] saved but public cache invalidation failed:', error)
    }
    return NextResponse.json({ ok: true, framing: submitted, cacheRefreshed })
  } catch {
    return NextResponse.json({ error: 'Unable to save framing. Your settings were not confirmed.' }, { status: 503 })
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
