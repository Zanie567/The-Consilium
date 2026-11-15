import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TAG_MANAGE_ROLES } from '@/lib/rbac'
import { withTestingAudit } from '@/lib/testingAudit'
import { renameTag, setTagDescription, setTagRetired } from '@/lib/tags/manage'
import { invalidBody, readJsonObject, refreshPublicTagPages, tagRouteError } from '@/lib/tags/api'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * PATCH { name? , description?, retired? }: rename (the address stays; the old name becomes an alias),
 * describe, retire or restore a tag. One change per request. Tag managers only.
 */
async function PATCHHandler(request: Request, { params }: Props) {
  const auth = await requireVerifiedSessionUser(TAG_MANAGE_ROLES)
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const changes = ['name', 'description', 'retired'].filter((key) => key in body)
  if (changes.length !== 1) return invalidBody()
  try {
    if ('name' in body) {
      const tag = await renameTag(prisma, id, body.name, auth.user.id)
      await refreshPublicTagPages()
      return NextResponse.json({ tag })
    }
    if ('description' in body) return NextResponse.json({ tag: await setTagDescription(prisma, id, body.description, auth.user.id) })
    if (typeof body.retired !== 'boolean') return invalidBody()
    const tag = await setTagRetired(prisma, id, body.retired, auth.user.id)
    await refreshPublicTagPages()
    return NextResponse.json({ tag })
  } catch (error) {
    return tagRouteError(error, 'update')
  }
}

export const PATCH = withTestingAudit(PATCHHandler)
