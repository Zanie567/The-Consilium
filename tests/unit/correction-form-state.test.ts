import { describe, expect, it, vi } from 'vitest'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
const { initialBaseVersion, initialFields, staleProposal } = await import('@/components/editorial/corrections/CorrectionForm')
import type { CorrectionRow, ManagerArticle } from '@/components/editorial/corrections/CorrectionsManager'

const article: ManagerArticle = {
  id: 'a', title: 'Current title', slug: 'a', excerpt: 'Current standfirst', content: 'CURRENT',
  status: 'PUBLISHED', publishedAt: null, updatedAt: '2026-10-17T00:00:00.000Z',
}
const pending = (baseVersion: string): CorrectionRow => ({
  id: 'c', type: 'CORRECTION', status: 'PENDING', publicNote: 'Note', originalText: 'was', correctedText: 'is',
  internalNote: 'evidence', baseVersion, proposed: { title: 'Proposed title', excerpt: null, content: 'PROPOSED' },
  previous: null, supersedesId: null, legacy: false, createdById: 'u', createdByName: 'U', approvedById: null,
  approvedByName: null, withdrawnReason: null, createdAt: '', updatedAt: '', publishedAt: null, withdrawnAt: null,
})

describe('revising a pending correction', () => {
  it('loads the proposal with its own base when the article has not changed', () => {
    const mode = { kind: 'revise' as const, correction: pending('v1') }
    expect(staleProposal('v1', mode)).toBeNull()
    expect(initialFields(article, 'v1', mode)).toMatchObject({ title: 'Proposed title', content: 'PROPOSED', publicNote: 'Note' })
    expect(initialBaseVersion('v1', mode)).toBe('v1')
  })

  it('starts from the current text against the current version when the article changed, keeping the proposal for reference', () => {
    const mode = { kind: 'revise' as const, correction: pending('v1') }
    expect(initialFields(article, 'v2', mode)).toMatchObject({
      title: 'Current title', excerpt: 'Current standfirst', content: 'CURRENT',
      publicNote: 'Note', originalText: 'was', correctedText: 'is', internalNote: 'evidence',
    })
    expect(initialBaseVersion('v2', mode)).toBe('v2')
    expect(staleProposal('v2', mode)).toEqual({ title: 'Proposed title', excerpt: '', content: 'PROPOSED' })
  })

  it('a new correction always starts from the live article and version', () => {
    expect(initialFields(article, 'v2', { kind: 'new' })).toMatchObject({ content: 'CURRENT', type: 'CORRECTION' })
    expect(initialBaseVersion('v2', { kind: 'new' })).toBe('v2')
    expect(staleProposal('v2', { kind: 'new' })).toBeNull()
  })
})
