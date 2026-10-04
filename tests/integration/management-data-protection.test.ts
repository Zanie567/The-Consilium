import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  caller: { role: 'ADMIN', id: 'administrator' } as { role: string; id: string } | null,
  db: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    category: { findMany: vi.fn() },
    categoryEditor: { deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    debate: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/auth', () => ({ getVerifiedSessionUser: vi.fn(async (roles: string[]) => mocks.caller && roles.includes(mocks.caller.role) ? mocks.caller : null) }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/components/editorial/UserProfileEditor', () => ({ UserProfileEditor: () => null }))
import { GET as getUser, PATCH as patchUser } from '@/app/api/editorial/users/[id]/route'
import { generateMetadata } from '@/app/editorial/(portal)/users/[id]/page'
import { PATCH as patchDebate } from '@/app/api/editorial/debates/[debateId]/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.caller = { role: 'ADMIN', id: 'administrator' }
  mocks.db.user.findUnique.mockResolvedValue({ id: 'target', role: 'WRITER', name: 'Private account', email: 'controlled@consilium.test', adminNotes: 'Private administrator notes' })
  mocks.db.user.update.mockResolvedValue({ id: 'target', name: 'Changed' })
  mocks.db.category.findMany.mockResolvedValue([])
  mocks.db.debate.findUnique.mockResolvedValue({ id: 'debate', isActive: false })
  mocks.db.debate.update.mockResolvedValue({ id: 'debate', isActive: true })
  mocks.db.$transaction.mockImplementation((callback: (tx: typeof mocks.db) => unknown) => callback(mocks.db))
})
const request = (body: unknown) => new Request('http://localhost/test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const userParams = () => ({ params: Promise.resolve({ id: 'target' }) })
const debateParams = () => ({ params: Promise.resolve({ debateId: 'debate' }) })

it.each(['EDITOR', 'WRITER', 'GROWTH', 'READER'])('does not expose private administrator notes to %s', async role => {
  mocks.caller = { role, id: 'other' }
  const response = await getUser(new Request('http://localhost/test'), userParams())
  expect(response.status).toBe(403)
  expect(mocks.db.user.findUnique).not.toHaveBeenCalled()
})
it('does not fetch a private account name for unauthorised page metadata', async () => {
  mocks.caller = null
  expect((await generateMetadata(userParams())).title).toBe('User Profile | Editorial')
  expect(mocks.db.user.findUnique).not.toHaveBeenCalled()
})
it.each(['invalid', ['missing-category'], ['same', 'same'], [123]])('invalid category assignments cannot partially save another profile field: %j', async categoryIds => {
  const response = await patchUser(request({ name: 'Changed', categoryIds }), userParams())
  expect(response.status).toBe(400)
  expect(mocks.db.user.update).not.toHaveBeenCalled()
  expect(mocks.db.categoryEditor.deleteMany).not.toHaveBeenCalled()
})
it('an invalid closing date cannot deactivate the currently active debate', async () => {
  const response = await patchDebate(request({ isActive: true, closesAt: 'invalid-date' }), debateParams())
  expect(response.status).toBe(400)
  expect(mocks.db.debate.updateMany).not.toHaveBeenCalled()
  expect(mocks.db.debate.update).not.toHaveBeenCalled()
})
it('activating a missing debate cannot deactivate other debates', async () => {
  mocks.db.debate.findUnique.mockResolvedValue(null)
  const response = await patchDebate(request({ isActive: true }), debateParams())
  expect(response.status).toBe(404)
  expect(mocks.db.debate.updateMany).not.toHaveBeenCalled()
})
