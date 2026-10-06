import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { LINKEDIN_SETTING_KEY, GROWTH_SETTINGS_TAG, validLinkedInUrl } from '@/lib/growthSettings'
export async function GET() {
  const auth = await requireVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!auth.ok) return auth.response
  const setting = await prisma.siteSetting.findUnique({
    where: { key: LINKEDIN_SETTING_KEY },
    select: { value: true },
  })
  return NextResponse.json({ linkedinUrl: setting?.value ?? null })
}
export async function PATCH(req: Request) {
  const auth = await requireVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!auth.ok) return auth.response
  let linkedinUrl: string | null
  try {
    linkedinUrl = validLinkedInUrl((await req.json()).linkedinUrl)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid URL' },
      { status: 400 }
    )
  }
  try {
    await prisma.siteSetting.upsert({
      where: { key: LINKEDIN_SETTING_KEY },
      create: { key: LINKEDIN_SETTING_KEY, value: linkedinUrl, updatedBy: auth.user.id },
      update: { value: linkedinUrl, updatedBy: auth.user.id },
    })
    revalidateTag(GROWTH_SETTINGS_TAG, { expire: 0 })
    return NextResponse.json({ linkedinUrl })
  } catch {
    return NextResponse.json(
      { error: 'Unable to save publication settings. Try again.' },
      { status: 503 }
    )
  }
}
