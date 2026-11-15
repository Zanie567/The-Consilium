// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiRequest } from '@/lib/apiClient'

vi.mock('next/link', () => ({ default: ({ children, href, prefetch: _p, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn(), asApiError: (reason: unknown) => reason as Error }))

const TAGS = [
  { id: '1', name: 'Inflation', slug: 'inflation', aliases: ['CPI'], articleCount: 12, retired: false },
  { id: '2', name: 'Monetary Policy', slug: 'monetary-policy', aliases: [], articleCount: 8, retired: false },
  { id: '3', name: 'Labour Markets', slug: 'labour-markets', aliases: [], articleCount: 3, retired: false },
  { id: '4', name: 'Old Topic', slug: 'old-topic', aliases: [], articleCount: 40, retired: true },
]

function catalogue(canManage: boolean) {
  vi.mocked(apiRequest).mockImplementation(async (url, options) => {
    if (url === '/api/editorial/tags' && !options?.method) return { tags: TAGS, canManage }
    if (url === '/api/editorial/tags' && options?.method === 'POST') return { tag: { id: 'n', name: JSON.parse(options.body as string).name, slug: 'x' } }
    if (url === '/api/editorial/tags/suggestions') return { suggestion: { id: 's', name: JSON.parse(options!.body as string).name } }
    throw new Error(`unexpected ${url}`)
  })
}

/** The selector with real state around it, as the editor holds it. */
async function mount(initial: string[] = [], props: { disabled?: boolean } = {}) {
  vi.resetModules()
  const { TagSelector } = await import('@/components/admin/article-editor/TagSelector')
  function Harness() {
    const [tags, setTags] = useState(initial)
    return <TagSelector tags={tags} onAdd={(n) => setTags((t) => [...t, n])} onRemove={(n) => setTags((t) => t.filter((x) => x !== n))} articleId="article-1" {...props} />
  }
  render(<Harness />)
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/editorial/tags', expect.anything()))
  await act(async () => {})
}

const input = () => screen.getByRole('combobox', { name: 'Article topics' })
const chips = () => (screen.queryByRole('list', { name: 'Chosen tags' })?.querySelectorAll('li span:first-child') ?? []).length
const chosen = () => [...(screen.queryByRole('list', { name: 'Chosen tags' })?.querySelectorAll('li > span:first-child') ?? [])].map((n) => n.textContent)
const type = (text: string) => { fireEvent.focus(input()); fireEvent.change(input(), { target: { value: text } }) }

beforeEach(() => catalogue(false))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('choosing approved tags', () => {
  it('picks the exact tag with Enter, in its approved spelling, whatever case was typed', async () => {
    await mount()
    type('monetary policy')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(chosen()).toEqual(['Monetary Policy'])
    expect(input()).toHaveProperty('value', '')
  })

  it('comma works like Enter', async () => {
    await mount()
    type('inflation')
    fireEvent.keyDown(input(), { key: ',' })
    expect(chosen()).toEqual(['Inflation'])
  })

  it('finds a tag by its alias and says so', async () => {
    await mount()
    type('cpi')
    expect(screen.getByRole('option', { name: /Inflation.*Also called “CPI”/ })).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(chosen()).toEqual(['Inflation'])
    expect(screen.getByRole('status').textContent).toMatch(/“CPI” is another name for “Inflation”/)
  })

  it('moves through matches with the arrow keys and picks with a click', async () => {
    await mount()
    type('l')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/Labour Markets/)]))
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
    fireEvent.click(screen.getByRole('option', { name: /Labour Markets/ }))
    expect(chosen()).toEqual(['Labour Markets'])
  })

  it('never offers a retired tag, and explains why when it is typed', async () => {
    await mount()
    type('old topic')
    expect(screen.queryByRole('option', { name: /Old Topic/ })).toBeNull()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(chosen()).toEqual([])
    expect(screen.getByRole('status').textContent).toMatch(/retired/)
  })

  it('does not offer a tag that is already chosen, and Backspace removes the last chip', async () => {
    await mount(['Inflation'])
    type('infl')
    expect(screen.queryByRole('option', { name: /^Inflation/ })).toBeNull()
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(chips()).toBe(0)
  })

  it('warns above three tags and stops at ten', async () => {
    await mount(['A', 'B', 'C', 'D'])
    expect(screen.getByText(/4 tags\. 1–3 precise tags/)).toBeTruthy()
    cleanup()
    await mount(Array.from({ length: 10 }, (_, i) => `T${i}`))
    expect(input()).toHaveProperty('disabled', true)
    expect(input().getAttribute('placeholder')).toBe('Max 10 tags')
  })

  it('shows chips with remove buttons, and none when editing is not allowed', async () => {
    await mount(['Inflation'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Inflation' }))
    expect(chosen()).toEqual([])
    cleanup()
    await mount(['Inflation'], { disabled: true })
    expect(screen.queryByRole('button', { name: 'Remove Inflation' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

describe('a wording that is not a tag yet', () => {
  it('a writer is offered a near match first, then "Suggest … for review", which adds nothing to the article', async () => {
    await mount()
    type('Labor Markets')
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toMatch(/Labour Markets.*Similar existing tag/)
    expect(options.at(-1)!.textContent).toBe('Suggest “Labor Markets” for review')
    fireEvent.click(options.at(-1)!)
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/editorial/tags/suggestions', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls.find(([u]) => u === '/api/editorial/tags/suggestions')![1]!.body as string)
    expect(body).toEqual({ name: 'Labor Markets', articleId: 'article-1' })
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Suggested “Labor Markets”.*not on the article yet/))
    expect(chosen()).toEqual([])
    expect(screen.queryByText(/Create “/)).toBeNull()
  })

  it('a tag manager is offered "Create … as a new tag", which creates it and adds it', async () => {
    catalogue(true)
    await mount()
    expect(screen.getByRole('link', { name: 'Manage tags' }).getAttribute('href')).toBe('/editorial/tags')
    type('Gig Economy')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(chosen()).toEqual(['Gig Economy']))
    expect(screen.getByRole('status').textContent).toMatch(/Created the tag “Gig Economy”/)
  })
})
