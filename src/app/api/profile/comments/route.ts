import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiServerErrorResponse } from '@/lib/apiResponse'

// GET /api/profile/comments - user's comments with article context
export async function GET() {
  const auth = await requireVerifiedSessionUser()
  if (!auth.ok) return auth.response
  const userId = auth.user.id

  try {
    const comments = await prisma.comment.findMany({
      where: { userId, isHidden: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        article: {
          select: { id: true, title: true, slug: true, category: { select: { name: true } } },
        },
        _count: { select: { upvotedBy: true } },
      },
    })

    return NextResponse.json(comments)
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'profile/comments:load',
      userMessage: 'Your comments could not be loaded because of a server error.',
      code: 'PROFILE_COMMENTS_LOAD_FAILED',
    })
  }
}
