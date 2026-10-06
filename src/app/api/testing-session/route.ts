import { randomBytes } from 'node:crypto'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TESTING_COOKIE, TEST_PERSONAS, PERSONA_ROLES, tokenHash, requireTestingWorkspace, type TestPersona } from '@/lib/testingMode'

async function realAdministrator(request: NextRequest) {
  // Require an Origin even when directly invoking this handler (not just proxy).
  if (request.headers.get('origin') !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin) return null
  await requireTestingWorkspace()
  const session = await getServerSession(authOptions)
  const id = session?.testing?.administratorId ?? session?.user.id
  if (!id) return null
  const user = await prisma.user.findUnique({ where: { id } })
  return user?.role === 'ADMIN' && user.isActive && !user.isBanned && user.emailVerified ? user : null
}

export async function POST(request: NextRequest) {
  try {
    const admin = await realAdministrator(request)
    if (!admin) return NextResponse.json({ error: 'Only an active verified administrator can start testing.' }, { status: 403 })
    const body = await request.json()
    if (Object.keys(body).some((key) => key !== 'persona') || !TEST_PERSONAS.includes(body.persona)) return NextResponse.json({ error: 'Choose an allowed testing persona.' }, { status: 400 })
    const persona = await prisma.user.findUnique({ where: { testPersonaKey: body.persona as TestPersona } })
    if (!persona || persona.role !== PERSONA_ROLES[body.persona as TestPersona] || !persona.emailVerified || !persona.isActive || persona.isBanned) return NextResponse.json({ error: 'The verified test persona is unavailable.' }, { status: 503 })
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: admin.id, role: 'ADMIN', isActive: true, isBanned: false, emailVerified: { not: null } }, data: { testingRevision: { increment: 1 } } })
      const previous = await tx.testingSession.findMany({ where: { administratorId: admin.id, stoppedAt: null } })
      for (const record of previous) await tx.auditLog.create({ data: { performedBy: admin.id, targetId: record.personaId, targetType: 'testing', action: 'testing:switch', metadata: { sessionId: record.id } } })
      await tx.testingSession.updateMany({ where: { administratorId: admin.id, stoppedAt: null }, data: { stoppedAt: new Date(), stopReason: 'switch' } })
      const record = await tx.testingSession.create({ data: { tokenHash: tokenHash(token), administratorId: admin.id, personaId: persona.id, revision: updated.testingRevision, expiresAt } })
      await tx.auditLog.create({ data: { performedBy: admin.id, targetId: persona.id, targetType: 'testing', action: 'testing:start', metadata: { sessionId: record.id, persona: body.persona, expiresAt: expiresAt.toISOString() } } })
    })
    const response = NextResponse.json({ ok: true })
    response.cookies.set(TESTING_COOKIE, token, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 86400 })
    return response
  } catch {
    return NextResponse.json({ error: 'Testing workspace is unavailable or not safely configured.' }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = await realAdministrator(request)
    if (!admin) return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 })
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: admin.id, role: 'ADMIN', isActive: true, isBanned: false, emailVerified: { not: null } }, data: { testingRevision: { increment: 1 } } })
      const active = await tx.testingSession.findMany({ where: { administratorId: admin.id, stoppedAt: null } })
      await tx.testingSession.updateMany({ where: { administratorId: admin.id, stoppedAt: null }, data: { stoppedAt: new Date(), stopReason: 'exit' } })
      for (const record of active) await tx.auditLog.create({ data: { performedBy: admin.id, targetId: record.personaId, targetType: 'testing', action: 'testing:exit', metadata: { sessionId: record.id } } })
    })
    const response = NextResponse.json({ ok: true })
    response.cookies.delete(TESTING_COOKIE)
    return response
  } catch {
    return NextResponse.json({ error: 'Testing mode could not be exited. Reload and try again.' }, { status: 503 })
  }
}
