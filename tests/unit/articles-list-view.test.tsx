// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ArticlesList } from '@/components/editorial/ArticlesList'
import type { ArticleListItem } from '@/lib/articleListView'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _prefetch, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/image', () => ({
  default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function MockImage({ fill: _fill, unoptimized: _unoptimized, fetchPriority: _fetchPriority, ...props }, ref) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img ref={ref} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
  }),
}))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: unknown) => reason }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const tag = (name: string) => ({ tag: { name, slug: name.toLowerCase().replaceAll(' ', '-') } })
function article(overrides: Partial<ArticleListItem> & { id: string }): ArticleListItem {
  return {
    title: `Article ${overrides.id}`, status: 'DRAFT', isFeatured: false, isPinned: false,
    updatedAt: '2026-11-01T10:00:00.000Z', publishedAt: null, scheduledAt: null, slug: `slug-${overrides.id}`,
    coverImage: null, author: { id: 'w1', name: 'Eleanor Hughes' }, category: { name: 'Analysis', slug: 'analysis' }, tags: [],
    ...overrides,
  }
}

const ARTICLES: ArticleListItem[] = [
  article({ id: 'pub', title: 'Rent Controls in Scotland', status: 'PUBLISHED', publishedAt: '2026-10-19T09:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z',
    coverImage: 'https://images.unsplash.com/photo-rent?w=1200', tags: [tag('Housing'), tag('Scotland'), tag('Inflation'), tag('Trade')], category: { name: 'News', slug: 'news' } }),
  article({ id: 'draft', title: 'Budget Notes', status: 'DRAFT', updatedAt: '2026-11-04T10:00:00.000Z', author: { id: 'w2', name: 'Other Writer' } }),
  article({ id: 'pending', title: 'Gilt Market', status: 'PENDING_REVIEW', updatedAt: '2026-11-03T10:00:00.000Z', coverImage: 'javascript:alert(1)' }),
  article({ id: 'sched', title: 'Winter Fuel', status: 'SCHEDULED', scheduledAt: '2026-12-01T09:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', coverImage: '/team/a.png' }),
  article({ id: 'rejected', title: 'Crypto as a Macro Asset', status: 'REJECTED', updatedAt: '2026-11-01T10:00:00.000Z', category: null }),
]

const rowFor = (title: string) => screen.getByText(title).closest('tr')!
const titles = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('link')[0].textContent)

describe('what each row shows', () => {
  it('shows the article’s own cover image as the thumbnail', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    expect(rowFor('Rent Controls in Scotland').querySelector('img')?.getAttribute('src')).toBe('https://images.unsplash.com/photo-rent?w=1200')
    expect(rowFor('Winter Fuel').querySelector('img')?.getAttribute('src')).toBe('/team/a.png')
  })

  it('says so when there is no cover, or the cover cannot be shown, instead of a broken image', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    const none = rowFor('Budget Notes')
    expect(none.querySelector('img')).toBeNull()
    expect(within(none).getByText('No cover image')).toBeTruthy()
    const invalid = rowFor('Gilt Market')
    expect(invalid.querySelector('img')).toBeNull()
    expect(within(invalid).getByText('Cover image could not be loaded')).toBeTruthy()
    // A cover that fails when the browser requests it ends the same way.
    fireEvent.error(rowFor('Rent Controls in Scotland').querySelector('img')!)
    expect(within(rowFor('Rent Controls in Scotland')).getByText('Cover image could not be loaded')).toBeTruthy()
  })

  it('shows title, author, format, tags, status and the relevant date', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    const row = within(rowFor('Rent Controls in Scotland'))
    expect(row.getByText('Eleanor Hughes')).toBeTruthy()
    expect(row.getAllByText('News').length).toBeGreaterThan(0)
    expect(row.getByText('PUBLISHED')).toBeTruthy()
    expect(row.getByText('Published 19 Oct 2026')).toBeTruthy()
    // Three tags are listed; the fourth is counted.
    const tags = within(row.getByRole('list', { name: 'Tags' }))
    expect(tags.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Housing', 'Scotland', 'Inflation', '+1'])
    expect(within(rowFor('Budget Notes')).getByText('Edited 4 Nov 2026')).toBeTruthy()
    expect(within(rowFor('Winter Fuel')).getByText(/1 Dec/)).toBeTruthy()
    expect(within(rowFor('Crypto as a Macro Asset')).getByText('Revisions requested')).toBeTruthy()
  })

  it('links the headline to the editor and labels an untitled draft', () => {
    render(<ArticlesList articles={[article({ id: 'x', title: '' })]} isEditor isWriter={false} />)
    const link = screen.getByRole('link', { name: '(Untitled)' })
    expect(link.getAttribute('href')).toBe('/editorial/articles/x/edit')
  })

  it('stays a table to assistive technology in both layouts', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Article', 'Format', 'Status', 'Actions'])
    expect(screen.getAllByRole('row')).toHaveLength(ARTICLES.length + 1)
  })
})

describe('search, filters and sorting', () => {
  it('searches title, author and tags, and the status tabs count what the search leaves', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    const search = screen.getByRole('searchbox', { name: 'Search articles by title, author or tag' })
    fireEvent.change(search, { target: { value: 'scotland' } })
    expect(titles()).toEqual(['Rent Controls in Scotland'])
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All1')
    expect(screen.getByRole('button', { name: /^DRAFT/ }).textContent).toBe('DRAFT0')
    fireEvent.change(search, { target: { value: 'other writer' } })
    expect(titles()).toEqual(['Budget Notes'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(titles()).toHaveLength(ARTICLES.length)
  })

  it('filters by status, by format and by missing cover', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^PUBLISHED/ }))
    expect(titles()).toEqual(['Rent Controls in Scotland'])
    expect(screen.getByRole('button', { name: /^PUBLISHED/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by format' }), { target: { value: 'none' } })
    expect(titles()).toEqual(['Crypto as a Macro Asset'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by format' }), { target: { value: 'all' } })

    fireEvent.click(screen.getByRole('checkbox', { name: /Without a cover image/ }))
    expect(titles()).toEqual(['Budget Notes', 'Gilt Market', 'Crypto as a Macro Asset'])
  })

  it('sorts by title and by publication date', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    expect(titles()[0]).toBe('Rent Controls in Scotland') // recently updated first
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort articles' }), { target: { value: 'title' } })
    expect(titles()).toEqual(['Budget Notes', 'Crypto as a Macro Asset', 'Gilt Market', 'Rent Controls in Scotland', 'Winter Fuel'])
  })

  it('offers a way out when nothing matches, and keeps the chosen sort', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort articles' }), { target: { value: 'title' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No articles match this filter.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(titles()[0]).toBe('Budget Notes')
  })

  it('paginates twelve to a page and returns to page 1 when a filter changes', () => {
    const many = Array.from({ length: 30 }, (_, i) => article({ id: `n${i}`, title: `Numbered ${String(i).padStart(2, '0')}`, updatedAt: new Date(Date.UTC(2026, 10, 30 - i)).toISOString() }))
    render(<ArticlesList articles={many} isEditor isWriter={false} />)
    expect(titles()).toHaveLength(12)
    expect(screen.getByText('Showing 1–12 of 30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 13–24 of 30')).toBeTruthy()
    // Every word must match: "numbered" and "2" leave 02, 12 and 20 to 29.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Numbered 2' } })
    expect(screen.getByText('Showing 1–12 of 12')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Article list pages' })).toBeNull()
  })

  it('says when older articles were left out of the list', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} truncated />)
    expect(screen.getByText(/older ones are not listed here/)).toBeTruthy()
  })

  it('shows the caller’s empty message when there are no articles at all', () => {
    render(<ArticlesList articles={[]} isEditor={false} isWriter emptyMessage={<span>You have no drafts yet.</span>} />)
    expect(screen.getByText('You have no drafts yet.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('actions follow the role (the server enforces the same rules)', () => {
  const actions = (title: string) => {
    const row = within(rowFor(title))
    return {
      publish: row.queryByRole('button', { name: 'Publish' }),
      unpublish: row.queryByRole('button', { name: 'Unpublish' }),
      pin: row.queryByRole('button', { name: 'Pin to category' }),
      corrections: row.queryByRole('link', { name: 'Corrections' }),
      review: row.queryByRole('link', { name: 'Review' }),
      carousel: row.queryByRole('link', { name: 'Manage homepage carousel in article editor' }),
      live: row.queryByRole('link', { name: 'View live article' }),
      edit: row.queryByRole('link', { name: 'Edit' }),
      remove: row.queryByRole('button', { name: 'Delete article' }),
    }
  }

  it('an editor keeps publishing, pinning, corrections, review and deletion', () => {
    render(<ArticlesList articles={ARTICLES} isEditor isWriter={false} />)
    const published = actions('Rent Controls in Scotland')
    for (const key of ['unpublish', 'pin', 'corrections', 'carousel', 'live', 'edit', 'remove'] as const) expect(published[key], key).not.toBeNull()
    expect(published.corrections!.getAttribute('href')).toBe('/editorial/articles/pub/corrections')
    expect(published.live!.getAttribute('href')).toBe('/articles/slug-pub')
    expect(actions('Budget Notes').publish).not.toBeNull()
    expect(actions('Gilt Market').review!.getAttribute('href')).toBe('/editorial/review/pending')
    // A scheduled article is published by the scheduler, not from the list.
    expect(actions('Winter Fuel').publish).toBeNull()
    expect(actions('Winter Fuel').remove).not.toBeNull()
  })

  it('a writer cannot publish, pin, correct or review, and can trash only a draft or returned article', () => {
    render(<ArticlesList articles={ARTICLES} isEditor={false} isWriter />)
    for (const title of ARTICLES.map((a) => a.title!)) {
      const a = actions(title)
      for (const key of ['publish', 'unpublish', 'pin', 'corrections', 'review', 'carousel'] as const) expect(a[key], `${title}: ${key}`).toBeNull()
      expect(a.edit, title).not.toBeNull()
    }
    expect(actions('Budget Notes').remove).not.toBeNull()
    expect(actions('Crypto as a Macro Asset').remove).not.toBeNull()
    for (const title of ['Rent Controls in Scotland', 'Gilt Market', 'Winter Fuel']) expect(actions(title).remove, title).toBeNull()
    expect(actions('Rent Controls in Scotland').live).not.toBeNull()
    // Authors are not listed for a writer: every row is their own.
    expect(screen.queryByText('Eleanor Hughes')).toBeNull()
  })
})
