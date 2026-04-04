import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
