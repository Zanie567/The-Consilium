import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** PATCH /api/user/achievements/mark-seen: marks the given achievements seen. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let ids: string[]
  try {
    const body = (await req.json()) as { ids: unknown }
    if (
      !Array.isArray(body.ids) ||
      !body.ids.every((id): id is string => typeof id === 'string')
    ) {
      return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 })
    }
    ids = body.ids
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (ids.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  try {
    // Scope to the caller's own unseen achievements so one user cannot mark
    // another user's achievements seen.
    const result = await prisma.writerAchievement.updateMany({
      where: { id: { in: ids }, seenAt: null, userId: session.user.id },
      data: { seenAt: new Date() },
    })

    return NextResponse.json({ updated: result.count })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
