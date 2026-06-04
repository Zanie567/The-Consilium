import { NextResponse } from 'next/server'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: Request) {
  const user = await getVerifiedSessionUser()
  if (!user) {
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
    const result = await prisma.articleTrophy.updateMany({
      where: {
        id: { in: ids },
        seenAt: null,
        article: { authorId: user.id },
      },
      data: { seenAt: new Date() },
    })

    return NextResponse.json({ updated: result.count })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
