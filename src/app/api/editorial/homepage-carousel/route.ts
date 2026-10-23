import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { GLOSSARY_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { publishedArticleWhere } from '@/lib/articleQueries'
import { revalidateArticleLists } from '@/lib/revalidateArticles'
import { HOME_CAROUSEL_SETTING_KEY, orderHomeCarousel, parseHomeCarouselSetting } from '@/lib/homeCarousel'
import { HERO_ROTATION_LIMIT } from '@/lib/heroArticles'

export const dynamic = 'force-dynamic'

/** Curate only published, visible, non-debate stories; never let the admin UI
 * accidentally put a withdrawn/draft article into the public front page. */
async function candidates() {
  return prisma.article.findMany({
    where: publishedArticleWhere({ isDebate: false }),
    orderBy: { publishedAt: { sort: 'desc', nulls: 'last' } },
    take: 16,
    select: { id: true, title: true, slug: true, publishedAt: true },
  })
}

export async function GET() {
  const auth = await requireVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  try {
    const [articles, setting] = await Promise.all([
      candidates(),
      prisma.siteSetting.findUnique({ where: { key: HOME_CAROUSEL_SETTING_KEY }, select: { value: true } }),
    ])
    const parsed = parseHomeCarouselSetting(setting?.value)
    const configured = parsed !== null && parsed.newestId === articles[0]?.id
    const selected = orderHomeCarousel(articles, configured ? parsed : null).map((a) => a.id)
    return NextResponse.json({
      articles,
      selected,
      configured,
      limit: HERO_ROTATION_LIMIT,
      message: configured
        ? 'Manual order is active until the next article is published.'
        : 'Displaying the newest published articles automatically.',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Carousel settings are temporarily unavailable.' }, { status: 503 })
  }
}

async function PATCHHandler(req: Request) {
  const auth = await requireVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  let ids: string[]
  try {
    const payload: unknown = await req.json()
    if (!payload || typeof payload !== 'object') throw new Error('Invalid body')
    const value = (payload as Record<string, unknown>).ids
    if (!Array.isArray(value) || value.length < 1 || value.length > HERO_ROTATION_LIMIT ||
      !value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128) ||
      new Set(value).size !== value.length) throw new Error('Invalid article selection')
    ids = value as string[]
  } catch {
    return NextResponse.json({ error: 'Choose one to three distinct published articles.' }, { status: 400 })
  }
  try {
    const articles = await candidates()
    if (!articles.length || ids.some((id) => !articles.some((a) => a.id === id))) {
      return NextResponse.json({ error: 'One or more selections are no longer eligible.' }, { status: 409 })
    }
    const value = JSON.stringify({ ids, newestId: articles[0].id })
    await prisma.siteSetting.upsert({
      where: { key: HOME_CAROUSEL_SETTING_KEY },
      create: { key: HOME_CAROUSEL_SETTING_KEY, value, updatedBy: auth.user.id },
      update: { value, updatedBy: auth.user.id },
    })
    revalidateArticleLists()
    return NextResponse.json({ ok: true, selected: ids, message: 'Carousel updated. A new publication automatically resets this order.' })
  } catch {
    return NextResponse.json({ error: 'Unable to save the carousel right now.' }, { status: 503 })
  }
}

async function DELETEHandler(_req: Request) {
  const auth = await requireVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  try {
    await prisma.siteSetting.upsert({
      where: { key: HOME_CAROUSEL_SETTING_KEY },
      create: { key: HOME_CAROUSEL_SETTING_KEY, value: null, updatedBy: auth.user.id },
      update: { value: null, updatedBy: auth.user.id },
    })
    revalidateArticleLists()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Unable to reset the carousel.' }, { status: 503 })
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
export const DELETE = withTestingAudit(DELETEHandler)
