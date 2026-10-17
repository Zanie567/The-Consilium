import { describe, expect, it } from 'vitest'
import {
  parseCorrectionDraft,
  parseRequestKey,
  parseRevision,
  parseWithdrawReason,
  suggestPublicNote,
  textChanged,
} from '@/lib/corrections/validation'
import { describeTextChanges, diffPassages, passagesOf } from '@/lib/corrections/diff'
import { correctionsHeading, correctionsStructuredData, legacyFallback, summariseCorrections } from '@/lib/corrections/public'
import type { PublicCorrection } from '@/lib/corrections/types'
import { CORRECTION_APPROVAL_ROLES, CORRECTION_PREPARE_ROLES } from '@/lib/rbac'

const doc = (...paragraphs: string[]) => JSON.stringify({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
})

const valid = {
  type: 'CORRECTION',
  publicNote: '  An earlier version of this article stated that unemployment had risen to 5.2%. The correct figure was 4.8%.  ',
  originalText: 'unemployment had risen to 5.2%',
  correctedText: 'the correct figure was 4.8%',
  internalNote: 'ONS release, table 3.',
  title: 'Labour market',
  excerpt: 'Standfirst',
  content: doc('Unemployment rose to 4.8%.'),
  baseVersion: 'a'.repeat(24),
}

describe('parseCorrectionDraft', () => {
  it('accepts a complete correction and trims the public note', () => {
    const parsed = parseCorrectionDraft(valid)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.publicNote.startsWith('An earlier')).toBe(true)
    expect(parsed.value.publicNote.endsWith('4.8%.')).toBe(true)
    expect(parsed.value.text).toEqual({ title: 'Labour market', excerpt: 'Standfirst', content: valid.content })
    expect(parsed.value.supersedesId).toBeNull()
  })

  it.each([
    ['an unknown type', { type: 'RETRACTION' }, 'Choose correction'],
    ['an empty public note', { publicNote: '   ' }, 'public note'],
    ['a note over 2000 characters', { publicNote: 'x'.repeat(2001) }, '2000 characters'],
    ['a correction without the original claim', { originalText: '' }, 'originally said'],
    ['a correction without the correct information', { correctedText: null }, 'originally said'],
    ['no title', { title: ' ' }, 'title'],
    ['no article text', { content: '' }, 'text is missing'],
    ['a missing base version', { baseVersion: undefined }, 'which version'],
    ['a malformed base version', { baseVersion: 'not-a-version' }, 'which version'],
    ['an internal note over the limit', { internalNote: 'x'.repeat(5001) }, '5000 characters'],
  ])('rejects %s', (_label, change, message) => {
    const parsed = parseCorrectionDraft({ ...valid, ...change })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain(message)
  })

  it('requires the misleading statement for a clarification, but nothing extra for an update', () => {
    expect(parseCorrectionDraft({ ...valid, type: 'CLARIFICATION', originalText: '' }).ok).toBe(false)
    expect(parseCorrectionDraft({ ...valid, type: 'CLARIFICATION', correctedText: '' }).ok).toBe(true)
    expect(parseCorrectionDraft({ ...valid, type: 'UPDATE', originalText: '', correctedText: '' }).ok).toBe(true)
  })

  it('refuses a figure without alt text, exactly as publication does', () => {
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'figure', attrs: { src: 'https://x.test/a.png', alt: '' } }] })
    const parsed = parseCorrectionDraft({ ...valid, content })
    expect(parsed.ok).toBe(false)
  })

  it('never reads identity, status or dates from the body', () => {
    const parsed = parseCorrectionDraft({ ...valid, createdById: 'someone-else', status: 'PUBLISHED', publishedAt: '1999-01-01' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(Object.keys(parsed.value).sort()).toEqual(['baseVersion', 'correctedText', 'internalNote', 'originalText', 'publicNote', 'supersedesId', 'text', 'type'])
  })
})

describe('small parsers', () => {
  it('requires a well-formed idempotency key', () => {
    expect(parseRequestKey('0f8fad5b-d9cb-469f-a165-70867728950e').ok).toBe(true)
    expect(parseRequestKey('short').ok).toBe(false)
    expect(parseRequestKey('has spaces in it, which is wrong').ok).toBe(false)
    expect(parseRequestKey(undefined).ok).toBe(false)
  })
  it('parses revisions strictly', () => {
    expect(parseRevision('2026-10-16T12:00:00.000Z')?.toISOString()).toBe('2026-10-16T12:00:00.000Z')
    expect(parseRevision('nonsense')).toBeNull()
    expect(parseRevision(12345)).toBeNull()
  })
  it('requires a withdrawal reason', () => {
    expect(parseWithdrawReason('  ').ok).toBe(false)
    expect(parseWithdrawReason('Duplicate of a correction already issued').ok).toBe(true)
  })
})

describe('textChanged', () => {
  const base = { title: 'T', excerpt: null, content: doc('a') }
  it('treats an empty and a missing standfirst as the same', () => {
    expect(textChanged(base, { ...base, excerpt: '' })).toBe(false)
    expect(textChanged(base, { ...base, excerpt: '  ' })).toBe(false)
  })
  it('detects a change to any reader-facing field', () => {
    expect(textChanged(base, { ...base, title: 'U' })).toBe(true)
    expect(textChanged(base, { ...base, excerpt: 'new' })).toBe(true)
    expect(textChanged(base, { ...base, content: doc('b') })).toBe(true)
  })
})

describe('suggestPublicNote', () => {
  it('drafts the house wording for a correction', () => {
    expect(suggestPublicNote('CORRECTION', 'unemployment had risen to 5.2%', 'the correct figure was 4.8%.'))
      .toBe('An earlier version of this article stated that unemployment had risen to 5.2%. The correct figure was 4.8%. The article has been amended.')
  })
  it('never calls an update a correction', () => {
    const note = suggestPublicNote('UPDATE', '', 'the Bank of England decision on 6 November')
    expect(note).toContain('updated')
    expect(note.toLowerCase()).not.toContain('correct')
  })
})

describe('passage diff', () => {
  it('splits TipTap JSON into passages, including list items separately', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Heading' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ] },
      ],
    })
    expect(passagesOf(content)).toEqual(['Heading', 'one', 'two'])
  })
  it('falls back to markup and plain text', () => {
    expect(passagesOf('<p>First</p><p>Second <b>bold</b></p>')).toEqual(['First', 'Second bold'])
  })
  it('reports removed and added passages in order', () => {
    expect(diffPassages(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'removed', text: 'b' }, { kind: 'added', text: 'x' }, { kind: 'same', text: 'c' },
    ])
  })
  it('summarises headline, standfirst and passages with context gaps', () => {
    const before = { title: 'Old', excerpt: 'S', content: doc('p1', 'p2', 'p3', 'p4', 'p5', 'p6') }
    const after = { title: 'New', excerpt: 'S', content: doc('p1', 'p2', 'p3', 'p4', 'p5', 'p6 changed') }
    const changes = describeTextChanges(before, after)
    expect(changes.title).toEqual({ before: 'Old', after: 'New' })
    expect(changes.excerpt).toBeNull()
    expect(changes.changedPassages).toBe(2)
    expect(changes.passages[0]).toEqual({ kind: 'same', text: 'p5' })
    expect(describeTextChanges(before, before).changed).toBe(false)
  })
})

const notice = (over: Partial<PublicCorrection>): PublicCorrection => ({
  id: 'c', type: 'CORRECTION', publicNote: 'n', publishedAt: '2026-10-16T09:00:00.000Z', legacy: false, supersedesId: null, ...over,
})

describe('public summary', () => {
  it('ranks correction above clarification above update and takes the latest date', () => {
    const summary = summariseCorrections([
      notice({ id: '1', type: 'UPDATE', publishedAt: '2026-10-20T09:00:00.000Z' }),
      notice({ id: '2', type: 'CORRECTION', publishedAt: '2026-10-16T09:00:00.000Z' }),
      notice({ id: '3', type: 'CLARIFICATION', publishedAt: '2026-10-18T09:00:00.000Z' }),
    ])
    expect(summary).toMatchObject({ type: 'CORRECTION', latestAt: '2026-10-20T09:00:00.000Z', total: 3 })
    expect(summariseCorrections([])).toBeNull()
  })
  it('never invents a date for an undated legacy correction', () => {
    expect(summariseCorrections([notice({ legacy: true, publishedAt: null })])?.latestAt).toBeNull()
  })
  it('labels the section by what it contains', () => {
    expect(correctionsHeading([notice({ type: 'UPDATE' }), notice({ type: 'CORRECTION' })])).toBe('Corrections')
    expect(correctionsHeading([notice({ type: 'UPDATE' })])).toBe('Updates')
    expect(correctionsHeading([notice({ type: 'CLARIFICATION' })])).toBe('Clarifications')
    expect(correctionsHeading([notice({ type: 'CLARIFICATION' }), notice({ type: 'UPDATE' })])).toBe('Clarifications and updates')
  })
  it('falls back to the legacy single note only when the article was marked corrected', () => {
    expect(legacyFallback({ id: 'a', corrected: false, correctionNote: 'never shown' })).toEqual([])
    expect(legacyFallback({ id: 'a', corrected: true, correctionNote: '  Old note  ' })).toEqual([
      { id: 'legacy_a', type: 'CORRECTION', publicNote: 'Old note', publishedAt: null, legacy: true, supersedesId: null },
    ])
    expect(legacyFallback({ id: 'a', corrected: true, correctionNote: '   ' })[0].publicNote).toBeNull()
  })
  it('emits schema.org CorrectionComment entries without inventing dates', () => {
    expect(correctionsStructuredData([notice({}), notice({ id: 'l', legacy: true, publishedAt: null, publicNote: 'old' }), notice({ id: 'x', publicNote: null })])).toEqual([
      { '@type': 'CorrectionComment', text: 'n', datePublished: '2026-10-16T09:00:00.000Z' },
      { '@type': 'CorrectionComment', text: 'old' },
    ])
  })
})

describe('approval roles', () => {
  it('editors prepare; only administrators approve, as the Corrections Policy promises a senior editor', () => {
    expect([...CORRECTION_PREPARE_ROLES]).toEqual(['ADMIN', 'EDITOR'])
    expect([...CORRECTION_APPROVAL_ROLES]).toEqual(['ADMIN'])
  })
})

describe('notification destinations', async () => {
  const { destination } = await import('@/components/editorial/NotificationBell')
  it('sends approvers to the pending correction, everyone else to the article', () => {
    expect(destination({ type: 'correction_submitted', articleId: 'a1' })).toBe('/editorial/articles/a1/corrections')
    expect(destination({ type: 'correction_published', articleId: 'a1' })).toBe('/editorial/articles/a1/edit')
    expect(destination({ type: 'published_article_flag', articleId: 'a1' })).toBe('/editorial/articles/a1/edit')
    expect(destination({ type: 'article_submitted', articleId: 'a1' })).toBe('/editorial/review/a1')
  })
})
