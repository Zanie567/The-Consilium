import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deploymentReadiness } from '@/lib/deploymentReadiness'
export async function GET() {
  const auth = await requireVerifiedSessionUser(['ADMIN'])
  if (!auth.ok) return auth.response
  try {
    const result = await deploymentReadiness(prisma)
    return NextResponse.json(result, { status: result.healthy ? 200 : 503 })
  } catch {
    return NextResponse.json({ healthy: false, gaps: ['Database unavailable'] }, { status: 503 })
  }
}
