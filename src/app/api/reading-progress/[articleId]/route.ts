import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Props { params: Promise<{ articleId: string }> }

// GET — fetch saved progress for a specific article
export async function GET(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json(null)

  const { articleId } = await params
  const row = await prisma.readingProgress.findUnique({
    where: { userId_articleId: { userId: session.user.id, articleId } },
    select: { progress: true, scrollY: true },
  }).catch(() => null)

  return NextResponse.json(row)
}
