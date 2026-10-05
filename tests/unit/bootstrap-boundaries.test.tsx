// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SetupPage from '@/app/editorial/setup/page'
import { SetupForm } from '@/app/editorial/setup/SetupForm'
import { POST } from '@/app/api/editorial/setup/route'
import { connection } from 'next/server'

const { rows, prisma } = vi.hoisted(() => {
  const rows: { role: string; email: string }[] = []
  let tail = Promise.resolve()
  const user = {
    findFirst: vi.fn(async () => rows.find(row => row.role === 'ADMIN') ?? null),
    create: vi.fn(async ({ data }: { data: { role: string; email: string } }) => { rows.push(data); return data }),
  }
  return { rows, prisma: { user, $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    let release: (() => void) | undefined
    const tx = { user, $executeRaw: async () => {
      const previous = tail
      tail = new Promise<void>(resolve => { release = resolve })
      await previous
      return 1
    } }
    try { return await run(tx) } finally { release?.() }
  } } }
})
vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('bcryptjs', () => ({ default: { hash: async () => 'controlled-hash' } }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), connection: vi.fn(async () => {}) }))
afterEach(() => { cleanup(); rows.length = 0; vi.clearAllMocks(); vi.unstubAllGlobals() })

it('the setup decision waits for a live request before touching the database', async () => {
  let arrive!: () => void
  vi.mocked(connection).mockReturnValueOnce(new Promise<void>(resolve => { arrive = resolve }))
  const page = SetupPage()
  expect(prisma.user.findFirst).not.toHaveBeenCalled()
  arrive()
  render(await page)
  expect(prisma.user.findFirst).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Create Admin Account' })).toBeTruthy()
})

it('a failed admin lookup cannot display the first-admin form', async () => {
  prisma.user.findFirst.mockRejectedValueOnce(new Error('Controlled admin lookup outage'))
  await expect(SetupPage()).rejects.toThrow('Controlled admin lookup outage')
})

it('two overlapping first-admin requests cannot both create administrator accounts', async () => {
  const request = (email: string) => new Request('http://localhost/api/editorial/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Controlled Admin', email, password: 'Controlled-password-123' }) })
  const responses = await Promise.all([POST(request('first@consilium.test')), POST(request('second@consilium.test'))])
  expect(responses.map(response => response.status).sort()).toEqual([200, 403])
  expect(rows.filter(row => row.role === 'ADMIN')).toHaveLength(1)
})

it('a failed setup request preserves all input and restores its submit control', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Controlled setup disconnect')))
  render(<SetupForm />)
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Controlled Admin' } })
  fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'controlled@consilium.test' } })
  const passwords = document.querySelectorAll('input[type="password"]')
  for (const password of passwords) fireEvent.change(password, { target: { value: 'Controlled-password-123' } })
  await act(async () => fireEvent.submit(passwords[0].closest('form')!))
  expect(screen.getByRole('alert').textContent).toContain('Check your connection and try again.')
  expect((screen.getByPlaceholderText('admin@example.com') as HTMLInputElement).value).toBe('controlled@consilium.test')
  expect((screen.getByRole('button', { name: 'Create Admin Account' }) as HTMLButtonElement).disabled).toBe(false)
})
