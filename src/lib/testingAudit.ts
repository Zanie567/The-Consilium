import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { auditTesting } from '@/lib/testingMode'

/** Record real/effective identities and the actual handler outcome. Never payloads/secrets. */
export function withTestingAudit<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    if (process.env.TESTING_MODE_ENABLED !== '1') return handler(...args)
    const session = await getServerSession(authOptions)
    if (!session?.testing) return handler(...args)
    const request = args[0] as Request
    const metadata = { sessionId: session.testing.id, method: request.method, path: new URL(request.url).pathname }
    try {
      const response = await handler(...args)
      await auditTesting(session.testing.administratorId, session.user.id, 'testing:mutation-result', { ...metadata, status: response.status })
      return response
    } catch (error) {
      await auditTesting(session.testing.administratorId, session.user.id, 'testing:mutation-failed', metadata)
      throw error
    }
  }
}
