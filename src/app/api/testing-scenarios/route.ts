import { NextRequest, NextResponse } from 'next/server'
import { realAdministrator } from '@/lib/testingAdmin'
import { TEST_PERSONAS, auditTesting, type TestPersona } from '@/lib/testingMode'
import { ScenarioError, applyScenario, resetScenarios, scenarioState } from '@/lib/testingScenarios'

export const dynamic = 'force-dynamic'

const isPersona = (value: unknown): value is TestPersona =>
  typeof value === 'string' && (TEST_PERSONAS as readonly string[]).includes(value)

/**
 * GET ?persona=writer -> what is currently applied to that persona.
 * POST { action: 'apply', persona, scenario } | { action: 'reset', persona? }
 *
 * Administrators only, on a verified isolated workspace only (both checked inside
 * `realAdministrator`, which throws on an unverified workspace). Only the five test personas can
 * be addressed; there is no way to name another account.
 */
async function guard(request: NextRequest, options: { requireOrigin?: boolean } = {}) {
  try {
    const admin = await realAdministrator(request, options)
    return admin ?? NextResponse.json({ error: 'Only an active verified administrator can use test scenarios.' }, { status: 403 })
  } catch {
    return NextResponse.json({ error: 'Testing workspace is unavailable or not safely configured.' }, { status: 503 })
  }
}

export async function GET(request: NextRequest) {
  const admin = await guard(request, { requireOrigin: false })
  if (admin instanceof NextResponse) return admin
  const persona = request.nextUrl.searchParams.get('persona')
  if (!isPersona(persona)) return NextResponse.json({ error: 'Choose a test persona.' }, { status: 400 })
  try {
    return NextResponse.json({ state: await scenarioState(persona) })
  } catch {
    return NextResponse.json({ error: 'Scenario state is unavailable.' }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { action, persona, scenario, ...rest } = body as Record<string, unknown>
  if (Object.keys(rest).length > 0) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  try {
    if (action === 'apply') {
      if (!isPersona(persona) || typeof scenario !== 'string') return NextResponse.json({ error: 'Choose a persona and a scenario.' }, { status: 400 })
      const result = await applyScenario(persona, scenario)
      await auditTesting(admin.id, admin.id, 'testing:scenario-apply', { persona, scenario: result.scenario })
      return NextResponse.json({ ok: true, ...result })
    }
    if (action === 'reset') {
      if (persona !== undefined && !isPersona(persona)) return NextResponse.json({ error: 'Choose a test persona.' }, { status: 400 })
      const result = await resetScenarios(persona)
      await auditTesting(admin.id, admin.id, 'testing:scenario-reset', { persona: persona ?? 'all' })
      return NextResponse.json({ ok: true, ...result })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (error) {
    if (error instanceof ScenarioError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    console.error('[testing-scenarios] failed', error)
    return NextResponse.json({ error: 'The scenario could not be applied. Nothing was changed.' }, { status: 500 })
  }
}
