// @vitest-environment jsdom
/**
 * The article page and homepage are cached at the CDN and identical for every visitor, so the parts
 * that depend on who is reading now personalise in the browser: the comment composer (client
 * session) and the debate vote (/api/debates/active). These pin that behaviour.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { DebateData } from '@/components/ui/DebatePanel'

const session = vi.hoisted(() => ({ value: { data: null as unknown, status: 'unauthenticated' as string } }))
vi.mock('next-auth/react', () => ({ useSession: () => session.value }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

import { CommentSection } from '@/components/ui/CommentSection'
import { DebatePanel } from '@/components/ui/DebatePanel'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

it('shows the sign-in prompt only once the client session says the reader is signed out', async () => {
  fetchMock.mockResolvedValue(json({ comments: [], total: 0 }))
  session.value = { data: null, status: 'loading' }
  const { rerender } = render(<CommentSection articleId="a1" />)
  expect(screen.queryByText(/to join the discussion/)).toBeNull()
  session.value = { data: null, status: 'unauthenticated' }
  rerender(<CommentSection articleId="a1" />)
  expect(screen.getByText(/to join the discussion/)).not.toBeNull()
})

it('offers the composer to a signed-in reader from the client session', async () => {
  fetchMock.mockResolvedValue(json({ comments: [], total: 0 }))
  session.value = { data: { user: { id: 'u1', name: 'Reader', role: 'READER' } }, status: 'authenticated' }
  render(<CommentSection articleId="a1" />)
  expect(screen.queryByText(/to join the discussion/)).toBeNull()
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
})

const debate: DebateData = {
  id: 'd1', title: 'Should rates fall?', description: null, isClosed: false, closesAt: null,
  forArticle: { id: 'f', title: 'For', slug: 'for', excerpt: null, author: 'A', readTime: '3 min read' },
  againstArticle: { id: 'g', title: 'Against', slug: 'against', excerpt: null, author: 'B', readTime: '3 min read' },
  hasVoted: false, userSide: null, totalVotes: 4,
}
const voteButtons = () => screen.getAllByRole('button').filter((b) => /vote|for|against/i.test(b.textContent ?? ''))

it('holds voting until it knows whether this viewer has already voted, then shows their vote', async () => {
  let answer: (r: Response) => void = () => {}
  fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve }))
  render(<DebatePanel initialData={debate} personalise />)
  expect(fetchMock).toHaveBeenCalledWith('/api/debates/active', expect.objectContaining({ credentials: 'include' }))
  expect(voteButtons().length).toBeGreaterThan(0)
  for (const button of voteButtons()) expect((button as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {
    answer(json({ ...debate, hasVoted: true, userSide: 'FOR', totalVotes: 5, forCount: 3, againstCount: 2, forPct: 60, againstPct: 40 }))
  })
  await waitFor(() => expect(screen.getByText(/60%/)).not.toBeNull())
})

it('enables voting for a viewer who has not voted', async () => {
  fetchMock.mockResolvedValueOnce(json({ ...debate }))
  render(<DebatePanel initialData={debate} personalise />)
  await waitFor(() => { for (const button of voteButtons()) expect((button as HTMLButtonElement).disabled).toBe(false) })
})

it('ignores an answer about a different debate, and still enables voting after a failed check', async () => {
  fetchMock.mockResolvedValueOnce(json({ ...debate, id: 'other', hasVoted: true, userSide: 'AGAINST', forPct: 10, againstPct: 90 }))
  render(<DebatePanel initialData={debate} personalise />)
  await waitFor(() => { for (const button of voteButtons()) expect((button as HTMLButtonElement).disabled).toBe(false) })
  expect(screen.queryByText(/90%/)).toBeNull()
  cleanup()
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  render(<DebatePanel initialData={debate} personalise />)
  await waitFor(() => { for (const button of voteButtons()) expect((button as HTMLButtonElement).disabled).toBe(false) })
})

it('does not ask when not personalising (the per-request /opinion-debate page)', () => {
  render(<DebatePanel initialData={debate} />)
  expect(fetchMock).not.toHaveBeenCalled()
})
