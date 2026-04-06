import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  if (!checkRateLimit(`signup:${getIp(request)}`, 5, 60 * 60 * 1000)) {
    return Response.json({ error: 'Too many signup attempts. Please try again later.' }, { status: 429 })
  }

  try {
    const body = await request.json()
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    if (!name || !email || !password) {
      return Response.json({ error: 'Name, email, and password are required.' }, { status: 400 })
    }

    if (name.length < 2 || name.length > 100) {
      return Response.json({ error: 'Name must be between 2 and 100 characters.' }, { status: 400 })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return Response.json({ error: 'Valid email required.' }, { status: 400 })
    }

    if (password.length < 8 || password.length > 128) {
      return Response.json({ error: 'Password must be between 8 and 128 characters.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ error: 'An account with that email already exists.' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role: 'READER' },
    })

    return Response.json({ id: user.id, email: user.email }, { status: 201 })
  } catch (error) {
    console.error('Signup error:', error)
    return Response.json({ error: 'Failed to create account.' }, { status: 500 })
  }
}
