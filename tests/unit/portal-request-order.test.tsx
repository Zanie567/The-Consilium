// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReadersDashboard } from '@/app/editorial/(portal)/readers/ReadersDashboard'
import { LeaderboardClient } from '@/app/editorial/(portal)/leaderboard/LeaderboardClient'
import { AdminUsersPage } from '@/components/admin/AdminUsersPage'
import { apiRequest } from '@/lib/apiClient'

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (e: Error) => e }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null }))
vi.mock('@/components/admin/UserDetailPanel', () => ({ UserDetailPanel: () => null }))
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(apiRequest).mockReset() })
const row = (id: string, title: string) => ({ id, title, slug: id, publishedAt: '2026-10-01T12:00:00Z', viewCount: 0, readerCount: 0, hasEnoughData: false, completionRate: null, medianProgress: null })
const detail = (id: string, title: string) => ({ article: row(id, title), stats: { readerCount: 0, hasEnoughData: false, completionRate: null, medianProgress: null, retention: null, steepestDrop: null } })
const league = (name: string) => ({ writers: [{ id: name, name, rank: 1, rankChange: null, articlesCount: 1, totalReadingMinutes: 1, avgCompletionRate: 0, avgViewsPerArticle: 0, commentsGenerated: 0 }] })

describe('latest portal selection owns the displayed result', () => {
  it('the author selector has an exact accessible name independent of its option labels', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) }))
    render(<ReadersDashboard currentUserId="admin" isAdmin authors={[{ id: 'writer', name: 'Representative Writer' }]} />)
    const selector = screen.getByRole('combobox', { name: /^Author$/ })
    fireEvent.change(selector, { target: { value: 'writer' } })
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/editorial/read-through?authorId=writer'))
  })

  it('a delayed first article cannot replace the second article detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ articles: [row('first', 'First article'), row('second', 'Second article')] }) }))
    const first = deferred<ReturnType<typeof detail>>()
    vi.mocked(apiRequest).mockImplementation(url => url.toString().endsWith('/first') ? first.promise : Promise.resolve(detail('second', 'Second article')))
    render(<ReadersDashboard currentUserId="writer" isAdmin={false} authors={[]} />)
    fireEvent.click(await screen.findByText('First article'))
    fireEvent.click(screen.getByText('Second article'))
    await screen.findByRole('heading', { name: 'Where readers get to: Second article' })
    await act(async () => { first.resolve(detail('first', 'First article')); await first.promise })
    expect(screen.queryByRole('heading', { name: 'Where readers get to: Second article' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Where readers get to: First article' })).toBeNull()
  })

  it.each(['success', 'failure'] as const)('an obsolete leaderboard %s cannot replace the current period', async outcome => {
    const old = deferred<ReturnType<typeof league>>()
    vi.mocked(apiRequest).mockImplementation(url => url.toString().endsWith('period=week') ? old.promise : Promise.resolve(league(url.toString().endsWith('period=alltime') ? 'Current period writer' : 'Initial period writer')))
    render(<LeaderboardClient currentUserId="reader" />)
    await screen.findByText('Initial period writer')
    fireEvent.click(screen.getByRole('button', { name: 'This Week' }))
    fireEvent.click(screen.getByRole('button', { name: 'All Time' }))
    await screen.findByText('Current period writer')
    await act(async () => {
      if (outcome === 'success') old.resolve(league('Obsolete period writer'))
      else old.reject(new Error('Obsolete period failure'))
      await old.promise.catch(() => {}) // Assert the explicitly failed, already handled probe.
    })
    expect(screen.queryByText('Current period writer')).not.toBeNull()
    expect(screen.queryByText('Obsolete period writer')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['success', 'failure'] as const)('an obsolete directory %s cannot replace the current filtered rows', async outcome => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 2, activeThisWeek: 1, banned: 0, staffCount: 2 }) }))
    const directory = (name: string) => ({ users: [{ id: name, name, email: `${name}@consilium.test`, role: 'READER', isActive: true, isBanned: false, bannedAt: null, bannedReason: null, createdAt: '2026-10-01T12:00:00Z', lastActiveAt: null, _count: { articles: 1, comments: 0, warnings: 0, debateVotes: 0 } }], total: 1, pages: 1 })
    const old = deferred<ReturnType<typeof directory>>()
    vi.mocked(apiRequest).mockImplementation(url => url.toString().includes('sort=oldest') ? old.promise : Promise.resolve(directory(url.toString().includes('sort=articleCount') ? 'Current directory user' : 'Initial directory user')))
    render(<AdminUsersPage currentAdminId="admin" />)
    await screen.findByText('Initial directory user')
    fireEvent.change(screen.getByLabelText('User sort'), { target: { value: 'oldest' } })
    fireEvent.change(screen.getByLabelText('User sort'), { target: { value: 'articleCount' } })
    await screen.findByText('Current directory user')
    await act(async () => {
      if (outcome === 'success') old.resolve(directory('Obsolete directory user'))
      else old.reject(new Error('Obsolete directory failure'))
      await old.promise.catch(() => {})
    })
    expect(screen.queryByText('Current directory user')).not.toBeNull()
    expect(screen.queryByText('Obsolete directory user')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
