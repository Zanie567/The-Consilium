import { describe, expect, it } from 'vitest'
import { articleStatusLabel } from '@/lib/articleStatusLabel'

describe('article status presentation', () => {
  it('calls a returned draft revisions requested rather than rejected', () => {
    expect(articleStatusLabel('REJECTED')).toBe('Revisions requested')
  })

  it('does not change the meaning of existing states', () => {
    expect(articleStatusLabel('DRAFT')).toBe('DRAFT')
    expect(articleStatusLabel('PENDING_REVIEW')).toBe('PENDING REVIEW')
    expect(articleStatusLabel('PUBLISHED')).toBe('PUBLISHED')
  })
})
