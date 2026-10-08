// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArticlesList } from '@/components/editorial/ArticlesList'
import { apiRequest } from '@/lib/apiClient'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: unknown) => reason }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('an earlier feature refresh cannot replace a newer pin revision before unpublishing', async () => {
  const initial = { id: 'article', title: 'Published fixture', status: 'PUBLISHED', isFeatured: false, isPinned: false,
    updatedAt: '2026-10-07T00:00:01.000Z', publishedAt: '2026-10-07T00:00:00.000Z', scheduledAt: null,
    slug: 'published-fixture', author: { id: 'writer', name: 'Writer' }, category: null }
  const featured = { ...initial, isFeatured: true, updatedAt: '2026-10-07T00:00:02.000Z' }
  const pinned = { ...featured, isPinned: true, updatedAt: '2026-10-07T00:00:03.000Z' }
  vi.mocked(apiRequest).mockImplementation(url => Promise.resolve(
    String(url).endsWith('/feature') ? featured : String(url).endsWith('/pin') ? pinned : { ...pinned, status: 'DRAFT' }
  ))
  const props = { isEditor: true, isWriter: false }
  const { rerender } = render(<ArticlesList {...props} articles={[initial]} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set as featured' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pin to category' })) })
  // The feature RSC response arrives only after the later pin has succeeded.
  await act(async () => { rerender(<ArticlesList {...props} articles={[featured]} />) })
  expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unpublish' })) })
  await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Unpublish' })) })
  const write = vi.mocked(apiRequest).mock.calls.find(([, options]) => options?.method === 'PUT')
  expect(write).toBeTruthy()
  expect(JSON.parse(write![1]!.body as string)).toMatchObject({ expectedUpdatedAt: pinned.updatedAt, status: 'DRAFT', publicationIntent: true })
  // A genuinely newer server snapshot must still replace the local row.
  await act(async () => { rerender(<ArticlesList {...props} articles={[{ ...pinned, title: 'New server title', updatedAt: '2026-10-07T00:00:04.000Z' }]} />) })
  expect(screen.getByText('New server title')).toBeTruthy()
  await act(async () => { rerender(<ArticlesList {...props} articles={[]} />) })
  expect(screen.queryByText('New server title')).toBeNull()
})
