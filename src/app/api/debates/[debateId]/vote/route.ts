import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createHash } from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions, requireActiveSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ debateId: string }>
}

export async function POST(req: Request, { params }: Props) {
  const { debateId } = await params

  // Rate limit: max 3 vote attempts per IP per hour
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(`vote:${ip}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: 'Too many vote attempts. Please try again later.' },
      { status: 429 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { side } = body as { side?: string }
  if (side !== 'FOR' && side !== 'AGAINST') {
    return NextResponse.json({ error: 'side must be FOR or AGAINST' }, { status: 400 })
  }

  // Validate debate exists and is active/open
  const debate = await prisma.debate.findUnique({
    where: { id: debateId },
    select: { isActive: true, closesAt: true },
  })
  if (!debate || !debate.isActive) {
    return NextResponse.json({ error: 'Debate not found or not active' }, { status: 404 })
  }
  if (debate.closesAt && new Date() > debate.closesAt) {
    return NextResponse.json({ error: 'Voting has closed for this debate' }, { status: 409 })
  }

  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()

  if (session) {
    const authError = requireActiveSession(session)
    if (authError) return authError
  }

  try {
    if (session?.user?.id) {
      // Authenticated vote - deduplicate by userId
      await prisma.debateVote.create({
        data: { debateId, userId: session.user.id, side: side as 'FOR' | 'AGAINST' },
      })
    } else {
      // Anonymous vote - deduplicate by cookie ID and by hashed IP
      let anonymousId = cookieStore.get('consilium_anon_id')?.value
      if (!anonymousId) {
        anonymousId = crypto.randomUUID()
      }
      // Salt the IP hash with a server-only secret so a stored hash cannot be
      // confirmed against a guessed IP. (This does not stop X-Forwarded-For
      // spoofing — robust anti-stuffing needs a trusted client IP or auth.)
      const anonIpHash = createHash('sha256')
        .update(`${process.env.NEXTAUTH_SECRET ?? ''}:${ip}`)
        .digest('hex')

      await prisma.debateVote.create({
        data: { debateId, anonymousId, anonIpHash, side: side as 'FOR' | 'AGAINST' },
      })

      // Set the httpOnly cookie in the response
      const counts = await getBreakdown(debateId)
      const response = NextResponse.json({ ...counts, userSide: side })
      response.cookies.set('consilium_anon_id', anonymousId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: '/',
      })
      return response
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'You have already voted on this debate.' }, { status: 409 })
    }
    throw err
  }

  const counts = await getBreakdown(debateId)
  return NextResponse.json({ ...counts, userSide: side })
}

async function getBreakdown(debateId: string) {
  const [groups, total] = await Promise.all([
    prisma.debateVote.groupBy({
      by: ['side'],
      where: { debateId },
      _count: { side: true },
    }),
    prisma.debateVote.count({ where: { debateId } }),
  ])
  const forCount = groups.find((g) => g.side === 'FOR')?._count.side ?? 0
  const againstCount = groups.find((g) => g.side === 'AGAINST')?._count.side ?? 0
  const forPct = total > 0 ? Math.round((forCount / total) * 100) : 0
  return { forCount, againstCount, forPct, againstPct: total > 0 ? 100 - forPct : 0, totalVotes: total }
}
