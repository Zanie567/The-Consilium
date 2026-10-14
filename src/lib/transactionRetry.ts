import { Prisma } from '@prisma/client'

/**
 * Classifying and retrying database transactions that PostgreSQL aborted because of concurrency.
 *
 *   conflict  deadlock_detected (40P01), serialization_failure (40001), Prisma P2034. PostgreSQL rolled the
 *             whole transaction back, so running it again is safe and usually succeeds at once.
 *   busy      lock_not_available (55P03, a `lock_timeout` expired), query_canceled (57014, a statement timeout),
 *             Prisma P2028 (the transaction could not start in time or expired before it committed). Nothing was
 *             committed, but the row is held by someone else: the caller is told to try again, not retried here.
 *
 * Where to find the SQLSTATE: with `@prisma/adapter-pg` a deadlock inside an ORM call arrives as a bare
 * DriverAdapterError (not a Prisma known error), and inside `$queryRaw` as P2010; both carry the code in
 * `cause.originalCode`. Only 40001 is mapped to P2034 by the adapter.
 */
export type TransactionFailure = 'conflict' | 'busy'

const CONFLICT_SQLSTATES = new Set(['40P01', '40001'])
const BUSY_SQLSTATES = new Set(['55P03', '57014'])

/** At most this many runs in total (the first one plus two retries). */
export const TRANSACTION_ATTEMPTS = 3

type Bag = Record<string, unknown>
const bag = (value: unknown): Bag | undefined => (value && typeof value === 'object' ? (value as Bag) : undefined)
const sqlStateOf = (value: unknown): string | undefined => {
  const cause = bag(value)
  const code = cause?.originalCode ?? cause?.code
  return typeof code === 'string' ? code : undefined
}

/** The PostgreSQL SQLSTATE behind `error`, from node-postgres, a Prisma driver-adapter error or a Prisma error wrapping one. */
export function postgresErrorCode(error: unknown, depth = 0): string | undefined {
  const e = bag(error)
  if (!e || depth > 4) return undefined
  if (e.name === 'DriverAdapterError') return sqlStateOf(e.cause)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = bag(error.meta)
    return sqlStateOf(bag(meta?.driverAdapterError)?.cause) ?? (typeof meta?.code === 'string' ? meta.code : undefined)
  }
  // node-postgres DatabaseError (its `code` is the SQLSTATE; Prisma's own codes never carry a severity).
  if (typeof e.code === 'string' && typeof e.severity === 'string') return e.code
  return postgresErrorCode(e.cause, depth + 1)
}

export function transactionFailure(error: unknown): TransactionFailure | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return 'conflict'
    if (error.code === 'P2028') return 'busy'
  }
  const code = postgresErrorCode(error)
  if (code && CONFLICT_SQLSTATES.has(code)) return 'conflict'
  if (code && BUSY_SQLSTATES.has(code)) return 'busy'
  return null
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `transaction` again, at most TRANSACTION_ATTEMPTS times in total, when PostgreSQL aborted it with a conflict.
 * Waits 20-60 ms, then 40-120 ms (jittered, so two victims do not collide again in lockstep). Any other failure, and
 * the last conflict, is thrown unchanged for the caller's error response.
 *
 * Wrap only a `$transaction(...)` whose callback does database work and nothing else: an email, a storage upload
 * or a cache revalidation inside it would be repeated. Those belong after the commit.
 */
export async function withTransactionRetry<T>(
  operation: string,
  transaction: () => Promise<T>,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? TRANSACTION_ATTEMPTS
  const sleep = options.sleep ?? pause
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction()
    } catch (error) {
      if (attempt >= attempts || transactionFailure(error) !== 'conflict') throw error
      console.warn('[transaction-retry]', { operation, attempt, code: postgresErrorCode(error) ?? 'P2034' })
      await sleep(20 * attempt * (1 + 2 * Math.random()))
    }
  }
}
