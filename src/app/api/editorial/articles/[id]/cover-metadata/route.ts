import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { EDITORIAL_MANAGEMENT_ROLES } from '@/lib/rbac'
import { editorCanAccessArticleCategory } from '@/lib/articleCategoryAccess'
import { withTestingAudit } from '@/lib/testingAudit'
import { coverMetadataKey, parseCoverMetadata, validateCoverMetadata } from '@/lib/coverImageMetadata'

interface Context { params: Promise<{ id: string }> }

async function authorisedCover(id: string) {
  const auth = await requireVerifiedSessionUser(EDITORIAL_MANAGEMENT_ROLES)
  if (!auth.ok) return { response: auth.response } as const
  const article = await prisma.article.findUnique({
    where: { id },
    select: { id: true, coverImage: true, categoryId: true, deletedAt: true },
  })
  if (!article || article.deletedAt) {
    return { response: NextResponse.json({ error: 'Article not found.' }, { status: 404 }) } as const
  }
  if (auth.user.role === 'EDITOR' &&
      !(await editorCanAccessArticleCategory(auth.user.id, article.categoryId))) {
    return { response: NextResponse.json({ error: 'This article is outside your assigned categories.' }, { status: 403 }) } as const
  }
  return { article, user: auth.user } as const
}

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params
  const auth = await authorisedCover(id)
  if ('response' in auth) return auth.response
  try {
    const setting = await prisma.siteSetting.findUnique({
      where: { key: coverMetadataKey(id) },
      select: { value: true },
    })
    return NextResponse.json({
      metadata: parseCoverMetadata(setting?.value, auth.article.coverImage),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Unable to load image details.' }, { status: 503 })
  }
}

async function PATCHHandler(req: Request, { params }: Context) {
  const { id } = await params
  const auth = await authorisedCover(id)
  if ('response' in auth) return auth.response
  let metadata
  try {
    metadata = validateCoverMetadata(await req.json())
  } catch {
    metadata = null
  }
  if (!metadata || !metadata.source || !metadata.caption) {
    return NextResponse.json({ error: 'A caption and a named image source are required. The source URL is optional.' }, { status: 400 })
  }
  if (!auth.article.coverImage || metadata.imageUrl !== auth.article.coverImage) {
    return NextResponse.json({ error: 'The cover image changed. Refresh before saving its attribution.' }, { status: 409 })
  }
  try {
    const key = coverMetadataKey(id)
    const value = JSON.stringify(metadata)
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: auth.user.id },
      update: { value, updatedBy: auth.user.id },
    })
    return NextResponse.json({ ok: true, metadata })
  } catch {
    return NextResponse.json({ error: 'Unable to save attribution.' }, { status: 503 })
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
