import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ADMIN_ONLY, ALL_ROLES } from '@/lib/rbac'
import { escapeLikePattern, normaliseSearchText } from '@/lib/searchText'

// GET /api/admin/users
// Paginated user list with search, role, status filters
export async function GET(request: NextRequest) {
  const admin = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  // `|| N` absorbs NaN: Math.max(1, parseInt('abc')) is NaN, not 1, and a NaN
  // skip/take makes Prisma throw — this route has no catch, so `?page=abc`
  // was a 500.
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.get('limit') ?? '25', 10) || 25)
  )
  const search = normaliseSearchText(searchParams.get('search') ?? undefined, 200) ?? ''
  const role = searchParams.get('role')?.toUpperCase() ?? ''
  const status = searchParams.get('status') ?? ''
  const sort = searchParams.get('sort') ?? 'createdAt'

  // Build where clause
  const where: Record<string, unknown> = {}

  if (search) {
    // Escaped so an admin searching for `%` gets literal matches rather than
    // every user in the table.
    const term = escapeLikePattern(search)
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
    ]
  }

  if (role && (ALL_ROLES as readonly string[]).includes(role)) {
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
  let orderBy: Record<string, unknown> = { createdAt: 'desc' }
  if (sort === 'oldest') orderBy = { createdAt: 'asc' }
  else if (sort === 'lastActive') orderBy = { lastActiveAt: { sort: 'desc', nulls: 'last' } }

  // Rank the entire filtered population before pagination. Counts deliberately
  // exclude trashed articles/hidden comments, matching the displayed tallies.
  // Values are bound parameters; SQL identifiers/fragments are fixed here.
  const countSort = sort === 'articleCount' || sort === 'commentCount'
  let rankedIds: string[] = []
  if (countSort) {
    const conditions = [Prisma.sql`TRUE`]
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`
      conditions.push(Prisma.sql`(u.name ILIKE ${pattern} OR u.email ILIKE ${pattern})`)
    }
    if (role && (ALL_ROLES as readonly string[]).includes(role)) conditions.push(Prisma.sql`u.role::text = ${role}`)
    if (status === 'banned') conditions.push(Prisma.sql`u."isBanned" = TRUE`)
    else if (status === 'active') conditions.push(Prisma.sql`u."isBanned" = FALSE AND u."isActive" = TRUE`)
    else if (status === 'warned') conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM user_warnings w WHERE w."userId" = u.id)`)
    const tally = sort === 'articleCount'
      ? Prisma.sql`(SELECT COUNT(*) FROM articles a WHERE a."authorId" = u.id AND a."deletedAt" IS NULL)`
      : Prisma.sql`(SELECT COUNT(*) FROM comments c WHERE c."userId" = u.id AND c."isHidden" = FALSE)`
    const ranked = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT u.id FROM users u WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${tally} DESC, u."createdAt" DESC, u.id ASC
      OFFSET ${(page - 1) * limit} LIMIT ${limit}`)
    rankedIds = ranked.map(row => row.id)
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: countSort ? { ...where, id: { in: rankedIds } } : where,
      orderBy,
      ...(!countSort && { skip: (page - 1) * limit, take: limit }),
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
            // Match the definitions used on Profile and every published-article
            // count: exclude soft-deleted (Trash) articles and hidden comments
            // so a user's tally is consistent across the app.
            articles: { where: { deletedAt: null } },
            comments: { where: { isHidden: false } },
            warnings: true,
            debateVotes: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ])

  const positions = new Map(rankedIds.map((id, index) => [id, index]))
  const sorted = countSort ? users.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!) : users

  return NextResponse.json({
    users: sorted,
    total,
    page,
    pages: Math.ceil(total / limit),
  })
}
