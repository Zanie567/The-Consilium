import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`contact:${getIp(req)}`, 5, 5 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const subject = String(body.subject ?? '').trim()
    const message = String(body.message ?? '').trim()

    if (!name || !email || !subject || !message) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or fewer.' }, { status: 400 })
    }

    if (subject.length > 200) {
      return NextResponse.json({ error: 'Subject must be 200 characters or fewer.' }, { status: 400 })
    }

    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message must be 5,000 characters or fewer.' }, { status: 400 })
    }

    await prisma.contactMessage.create({
      data: { name, email, subject, message },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to send message.' }, { status: 500 })
  }
}
