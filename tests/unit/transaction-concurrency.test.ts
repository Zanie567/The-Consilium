/**
 * Issues #128 / #129: how aborted and timed-out transactions are classified, retried and reported, and how a
 * duplicate vote is told apart from a real database failure. The error shapes are the ones @prisma/adapter-pg 7.6
 * produced against PostgreSQL 17.11 when this was written; tests/integration/debate-lock-order-db.test.ts exercises
 * the real ones end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }))

import { postgresErrorCode, transactionFailure, withTransactionRetry, TRANSACTION_ATTEMPTS } from '@/lib/transactionRetry'
import { apiServerErrorResponse, articleMutationErrorResponse, transactionFailureResponse } from '@/lib/apiResponse'
import { isDuplicateVote, VOTE_LOCK_TIMEOUT_MS, VOTE_STATEMENT_TIMEOUT_MS, VOTE_TRANSACTION_OPTIONS } from '@/lib/debateVoting'
import { transitionDebate } from '@/lib/debateLifecycle'

/** What a deadlock inside an ORM call looks like with the pg driver adapter: not a Prisma known error at all. */
function adapterError(sqlState: string, message: string) {
  return Object.assign(new Error(message), {
    name: 'DriverAdapterError',
    cause: { originalCode: sqlState, originalMessage: message, kind: 'postgres', code: sqlState, severity: 'ERROR', message },
  })
}
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: 'test', meta })
/** A raw query failure ($queryRaw): P2010 wrapping the driver error. */
const rawFailure = (sqlState: string) =>
  known('P2010', { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: sqlState, kind: 'postgres', code: sqlState } } })
const pgError = (code: string) => Object.assign(new Error('pg'), { code, severity: 'ERROR' })

describe('transactionFailure', () => {
  it.each([
    ['a deadlock in an ORM call (bare DriverAdapterError)', adapterError('40P01', 'deadlock detected')],
    ['a deadlock in a raw query (P2010)', rawFailure('40P01')],
    ['a serialization failure', adapterError('40001', 'could not serialize access')],
    ['Prisma P2034 (write conflict or deadlock)', known('P2034')],
    ['a node-postgres deadlock', pgError('40P01')],
    ['a deadlock wrapped as the cause of another error', Object.assign(new Error('outer'), { cause: adapterError('40P01', 'deadlock detected') })],
  ])('%s is a retryable conflict', (_label, error) => {
    expect(transactionFailure(error)).toBe('conflict')
  })

  it.each([
    ['a lock_timeout (55P03) in an ORM call', adapterError('55P03', 'canceling statement due to lock timeout')],
    ['a lock_timeout in a raw query', rawFailure('55P03')],
    ['a statement timeout (57014)', adapterError('57014', 'canceling statement due to statement timeout')],
    ['an expired or unstartable transaction (P2028)', known('P2028', { operation: 'commit', timeout: 5000 })],
  ])('%s is "busy"', (_label, error) => {
    expect(transactionFailure(error)).toBe('busy')
  })

  it.each([
    ['a unique violation', known('P2002', { modelName: 'DebateVote' })],
    ['the hidden-debate guard (23514)', rawFailure('23514')],
    ['a record not found', known('P2025')],
    ['a connection failure', known('P1001')],
    ['a plain error mentioning a deadlock', new Error('deadlock detected')],
    ['a PL/pgSQL raise (P0001), not a Prisma code', pgError('P0001')],
    ['nothing', undefined],
  ])('%s is not a transaction failure', (_label, error) => {
    expect(transactionFailure(error)).toBeNull()
  })

  it('reads the SQLSTATE from every shape', () => {
    expect(postgresErrorCode(adapterError('40P01', 'x'))).toBe('40P01')
    expect(postgresErrorCode(rawFailure('55P03'))).toBe('55P03')
    expect(postgresErrorCode(known('P2010', { code: '40P01' }))).toBe('40P01') // query-engine shape
    expect(postgresErrorCode(known('P2025'))).toBeUndefined()
  })
})

describe('withTransactionRetry', () => {
  const sleep = vi.fn(async () => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  beforeEach(() => { sleep.mockClear(); warn.mockClear() })

  it('runs again after a conflict and returns the successful result', async () => {
    const run = vi.fn().mockRejectedValueOnce(adapterError('40P01', 'deadlock detected')).mockResolvedValueOnce('done')
    await expect(withTransactionRetry('op', run, { sleep })).resolves.toBe('done')
    expect(run).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[transaction-retry]', { operation: 'op', attempt: 1, code: '40P01' })
  })

  it(`gives up after ${TRANSACTION_ATTEMPTS} attempts and throws the last conflict unchanged`, async () => {
    const last = adapterError('40P01', 'deadlock detected (last)')
    const run = vi.fn()
      .mockRejectedValueOnce(adapterError('40P01', 'deadlock detected'))
      .mockRejectedValueOnce(known('P2034'))
      .mockRejectedValueOnce(last)
    await expect(withTransactionRetry('op', run, { sleep })).rejects.toBe(last)
    expect(run).toHaveBeenCalledTimes(TRANSACTION_ATTEMPTS)
    expect(TRANSACTION_ATTEMPTS).toBe(3)
  })

  it.each([
    ['a lock timeout', adapterError('55P03', 'lock timeout')],
    ['a transaction timeout', known('P2028')],
    ['a duplicate vote', known('P2002')],
    ['an application refusal', new Error('INVALID_STATE')],
  ])('never retries %s', async (_label, error) => {
    const run = vi.fn().mockRejectedValue(error)
    await expect(withTransactionRetry('op', run, { sleep })).rejects.toBe(error)
    expect(run).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits a short, growing, jittered interval between attempts', async () => {
    const delays: number[] = []
    const run = vi.fn().mockRejectedValue(known('P2034'))
    await withTransactionRetry('op', run, { sleep: async (ms) => { delays.push(ms) } }).catch(() => {})
    expect(delays).toHaveLength(2)
    expect(delays[0]).toBeGreaterThanOrEqual(20)
    expect(delays[0]).toBeLessThanOrEqual(60)
    expect(delays[1]).toBeGreaterThanOrEqual(40)
    expect(delays[1]).toBeLessThanOrEqual(120)
  })
})

describe('responses', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})

  it('an exhausted conflict is a 409 CONCURRENT_UPDATE, not a 500', async () => {
    const res = apiServerErrorResponse(adapterError('40P01', 'deadlock detected'), { operation: 't', userMessage: 'x', code: 'X_FAILED', requestId: 'r1' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CONCURRENT_UPDATE', requestId: 'r1' })
  })

  it('a lock or transaction timeout is a 503 DATABASE_BUSY with Retry-After', async () => {
    for (const error of [adapterError('55P03', 'lock timeout'), known('P2028')]) {
      const res = transactionFailureResponse(error)!
      expect(res.status).toBe(503)
      expect(res.headers.get('Retry-After')).toBe('2')
      expect(await res.json()).toMatchObject({ code: 'DATABASE_BUSY' })
    }
  })

  it('the article save maps the same failures (it used to fall through to a 500)', async () => {
    expect((await articleMutationErrorResponse(rawFailure('40P01'), 'update', 'r').json()).code).toBe('CONCURRENT_UPDATE')
    expect((await articleMutationErrorResponse(adapterError('40P01', 'deadlock detected'), 'update', 'r').json()).code).toBe('CONCURRENT_UPDATE')
    expect(articleMutationErrorResponse(known('P2028'), 'update', 'r').status).toBe(503)
    // Unchanged mappings still win for their own errors.
    expect((await articleMutationErrorResponse(known('P2002'), 'update', 'r').json()).code).toBe('SLUG_CONFLICT')
    expect(articleMutationErrorResponse(new Error('boom'), 'update', 'r').status).toBe(500)
  })

  it('every other error keeps its existing response', () => {
    expect(transactionFailureResponse(new Error('boom'))).toBeNull()
    expect(apiServerErrorResponse(new Error('boom'), { operation: 't', userMessage: 'x', code: 'X_FAILED' }).status).toBe(500)
  })
})

describe('transitionDebate under repeated deadlocks', () => {
  it('retries the whole transaction a bounded number of times, then surfaces a 409, never a 500', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deadlock = adapterError('40P01', 'deadlock detected')
    const client = { $transaction: vi.fn(async () => { throw deadlock }) }
    const error = await transitionDebate({ id: 'admin' }, 'debate', 'unpublish', {}, client as never).catch((e: unknown) => e)
    expect(error).toBe(deadlock)
    expect(client.$transaction).toHaveBeenCalledTimes(TRANSACTION_ATTEMPTS)
    const res = apiServerErrorResponse(error, { operation: 'debate:unpublish', userMessage: 'x', code: 'DEBATE_LIFECYCLE_FAILED' })
    expect(res.status).toBe(409)
  })
})

describe('isDuplicateVote (#129)', () => {
  const adapterUnique = (fields: string[], constraint: string) => known('P2002', {
    modelName: 'DebateVote',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
        kind: 'UniqueConstraintViolation',
        constraint: { fields },
      },
    },
  })

  it.each([
    ['a member', ['"debateId"', '"userId"'], 'debate_votes_debateId_userId_key'],
    ['an anonymous cookie', ['"debateId"', '"anonymousId"'], 'debate_votes_debateId_anonymousId_key'],
    ['an anonymous address', ['"debateId"', '"anonIpHash"'], 'debate_votes_debateId_anonIpHash_key'],
  ])('recognises a repeat vote by %s (driver adapter shape)', (_label, fields, constraint) => {
    expect(isDuplicateVote(adapterUnique(fields, constraint))).toBe(true)
  })

  it('recognises the query-engine shape too (target as fields or as the constraint name)', () => {
    expect(isDuplicateVote(known('P2002', { modelName: 'DebateVote', target: ['debateId', 'userId'] }))).toBe(true)
    expect(isDuplicateVote(known('P2002', { target: 'debate_votes_debateId_anonIpHash_key' }))).toBe(true)
  })

  it.each([
    ['a unique violation on the vote id', adapterUnique(['"id"'], 'debate_votes_pkey')],
    ['a unique violation on another model', known('P2002', { modelName: 'Article', target: ['slug'] })],
    ['a unique violation with no target at all', known('P2002', { modelName: 'DebateVote' })],
    ['a foreign-key failure', known('P2003', { modelName: 'DebateVote' })],
    ['a deadlock', adapterError('40P01', 'deadlock detected')],
    ['a lock timeout', adapterError('55P03', 'lock timeout')],
    ['a plain error whose text says "Unique constraint"', new Error('Unique constraint failed on the fields: (`debateId`,`userId`)')],
  ])('does not report %s as "already voted"', (_label, error) => {
    expect(isDuplicateVote(error)).toBe(false)
  })
})

describe('vote transaction bounds (#129)', () => {
  it('every server-side limit fires before Prisma\'s own transaction timeout', () => {
    // lock_timeout bounds one lock wait; a statement can wait more than once, so statement_timeout bounds a statement.
    // Three statements can wait (article locks, debate locks, the insert): all of them fit inside the timeout.
    expect(VOTE_LOCK_TIMEOUT_MS).toBeLessThan(VOTE_STATEMENT_TIMEOUT_MS)
    expect(3 * VOTE_STATEMENT_TIMEOUT_MS).toBeLessThan(VOTE_TRANSACTION_OPTIONS.timeout)
    expect(VOTE_TRANSACTION_OPTIONS).toEqual({ maxWait: 2_000, timeout: 7_000 })
  })
})
