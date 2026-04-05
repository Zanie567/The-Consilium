import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

interface Props {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { isActive, password, categoryIds } = body

  const updates: Record<string, unknown> = {}
  if (typeof isActive === 'boolean') updates.isActive = isActive
  if (password) {
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }
    updates.password = await bcrypt.hash(password, 10)
  }

  const user = await prisma.user.update({
    where: { id },
    data: updates,
    select: { id: true, name: true, role: true, isActive: true },
  })

  // Update category assignments for editors
  if (categoryIds !== undefined && user.role === 'EDITOR') {
    await prisma.categoryEditor.deleteMany({ where: { userId: id } })
    if (categoryIds.length > 0) {
      await prisma.categoryEditor.createMany({
        data: categoryIds.map((cid: string) => ({ userId: id, categoryId: cid })),
      })
    }
  }

  return NextResponse.json(user)
}

export async function DELETE(_req: Request, { params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  // Prevent admin from deleting themselves
  if (id === session.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account.' }, { status: 400 })
  }

  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
