import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GLOSSARY_MANAGE_ROLES } from '@/lib/rbac'
import { GLOSSARY_ENABLED_KEY } from '@/lib/constants'
import { GLOSSARY_CACHE_TAG } from '@/lib/glossary/data'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/editorial/glossary/settings
 * Site-wide glossary linking switch, stored in site_settings under
 * GLOSSARY_ENABLED_KEY. A missing row means OFF. ADMIN only
 * (GLOSSARY_MANAGE_ROLES), re-verified against the database.
 * Body: { enabled: boolean }
 */
export async function PATCH(req: Request) {
  const caller = await getVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!caller) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let enabled: boolean
  try {
    const body = (await req.json()) as { enabled: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean.' }, { status: 400 })
    }
    enabled = body.enabled
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  try {
    const value = enabled ? 'true' : 'false'
    await prisma.siteSetting.upsert({
      where: { key: GLOSSARY_ENABLED_KEY },
      create: { key: GLOSSARY_ENABLED_KEY, value, updatedBy: caller.id },
      update: { value, updatedBy: caller.id },
    })
    revalidateTag(GLOSSARY_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ ok: true, enabled })
  } catch (err) {
    console.error(
      '[glossary] settings PATCH error:',
      err instanceof Error ? err.message : String(err)
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
