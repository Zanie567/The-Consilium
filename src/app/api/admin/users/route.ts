import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function isAdmin(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  if (!session) return false
  const user = (session as { user?: { role?: string; isBanned?: boolean } }).user
  return user?.role === 'ADMIN' && !user?.isBanned
}

// GET /api/admin/users
// Paginated user list with search, role, status filters
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25')))
  const search = searchParams.get('search')?.trim() ?? ''
  const role   = searchParams.get('role')?.toUpperCase() ?? ''
  const status = searchParams.get('status') ?? ''
  const sort   = searchParams.get('sort') ?? 'createdAt'

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  if (role && ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'].includes(role)) {
    where.role = role
  }

  if (status === 'banned') {
    where.isBanned = true
  } else if (status === 'active') {
    where.isBanned = false
    where.isActive = true
  } else if (status === 'warned') {
    where.warnings = { some: {} }
  }

  // Build orderBy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any = { createdAt: 'desc' }
  if (sort === 'oldest') orderBy = { createdAt: 'asc' }
  else if (sort === 'lastActive') orderBy = { lastActiveAt: { sort: 'desc', nulls: 'last' } }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: sort === 'articleCount' || sort === 'commentCount' ? { createdAt: 'desc' } : orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastActiveAt: true,
        isBanned: true,
        bannedAt: true,
        bannedReason: true,
        _count: {
          select: {
            articles: true,
            comments: true,
            warnings: true,
            debateVotes: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ])

  // For article/comment count sorts, sort in memory (avoid complex join-based sorts)
  let sorted = users
  if (sort === 'articleCount') {
    sorted = [...users].sort((a, b) => b._count.articles - a._count.articles)
  } else if (sort === 'commentCount') {
    sorted = [...users].sort((a, b) => b._count.comments - a._count.comments)
  }

  return NextResponse.json({
    users: sorted,
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
