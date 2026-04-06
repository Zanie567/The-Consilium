import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`subscribe:${getIp(request)}`, 3, 10 * 60 * 1000)) {
    return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  try {
    const body = await request.json()
    const email = String(body.email ?? '').trim().toLowerCase()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return Response.json({ error: 'Valid email required' }, { status: 400 })
    }

    const existing = await prisma.subscriber.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ message: 'Already subscribed' })
    }

    await prisma.subscriber.create({ data: { email } })
    return Response.json({ message: 'Subscribed successfully' }, { status: 201 })
  } catch (error) {
    console.error('Subscribe error:', error)
    return Response.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}
