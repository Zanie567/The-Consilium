import { describe, it, expect, vi } from 'vitest'

// The real guard, with a database that would fail the test if it were ever reached.
const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: transaction, siteSetting: { findUnique: transaction }, user: { findUnique: transaction } } }))
import { applyScenario, resetScenarios, scenarioState } from '@/lib/testingScenarios'

describe('scenarios refuse to run outside a verified workspace', () => {
  it('apply, reset and state all fail closed before touching any data', async () => {
    // Vitest's environment is deliberately not a testing workspace: TESTING_MODE_ENABLED=0.
    await expect(applyScenario('writer', 'unread-notifications')).rejects.toThrow('Testing mode is disabled')
    await expect(resetScenarios()).rejects.toThrow('Testing mode is disabled')
    await expect(scenarioState('writer')).rejects.toThrow('Testing mode is disabled')
    expect(transaction).not.toHaveBeenCalled()
  })
})
