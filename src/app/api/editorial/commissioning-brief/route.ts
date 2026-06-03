/**
 * /api/editorial/commissioning-brief
 *
 * GET   - public. Returns { brief: string | null }.
 * PATCH - ADMIN or GROWTH only. Sets or clears the brief.
 *
 * WAITING FOR SCHEMA: the site_settings table must be created in Supabase before
 * this route can read or write. The CREATE TABLE SQL has been output to the
 * operator (see AI_STATE.md). Until it is applied, GET returns { brief: null } and
 * PATCH returns a 500; the dashboard still renders because its server-side read is
 * wrapped in try/catch.
 */

import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_ACCESS_ROLES } from '@/lib/rbac'
import { COMMISSIONING_BRIEF_KEY, COMMISSIONING_BRIEF_MAX_LENGTH } from '@/lib/constants'

export const dynamic = 'force-dynamic'

/** GET /api/editorial/commissioning-brief: the current brief, or null. Public. */
export async function GET() {
  try {
    const setting = await prisma.siteSetting.findUnique({
      where: { key: COMMISSIONING_BRIEF_KEY },
      select: { value: true },
    })
    return NextResponse.json({ brief: setting?.value ?? null })
  } catch (err) {
    // Most likely the site_settings table does not exist yet. Degrade to "no
    // brief" rather than failing, so public callers never see a 500.
    console.error(
      '[commissioning-brief] GET error:',
      err instanceof Error ? err.message : String(err)
    )
    return NextResponse.json({ brief: null })
  }
}

/** PATCH /api/editorial/commissioning-brief: set or clear the brief. ADMIN/GROWTH. */
export async function PATCH(req: Request) {
  const user = await getVerifiedSessionUser(ANALYTICS_ACCESS_ROLES)
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let brief: string | null
  try {
    const body = (await req.json()) as { brief: unknown }
    const raw = body.brief
    if (raw === null) {
      brief = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.length > COMMISSIONING_BRIEF_MAX_LENGTH) {
        return NextResponse.json(
          { error: `Brief must be ${COMMISSIONING_BRIEF_MAX_LENGTH} characters or fewer.` },
          { status: 400 }
        )
      }
      brief = trimmed.length === 0 ? null : trimmed
    } else {
      return NextResponse.json({ error: 'brief must be a string or null' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const setting = await prisma.siteSetting.upsert({
      where: { key: COMMISSIONING_BRIEF_KEY },
      create: { key: COMMISSIONING_BRIEF_KEY, value: brief, updatedBy: user.id },
      update: { value: brief, updatedBy: user.id },
      select: { value: true },
    })
    return NextResponse.json({ brief: setting.value ?? null })
  } catch (err) {
    console.error(
      '[commissioning-brief] PATCH error:',
      err instanceof Error ? err.message : String(err)
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
