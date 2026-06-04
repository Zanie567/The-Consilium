import { describe, it, expect } from 'vitest'
import { escapeHtml } from '@/lib/escapeHtml'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<tag>"x" & 'y'`)).toBe('&lt;tag&gt;&quot;x&quot; &amp; &#39;y&#39;')
  })

  it('escapes & first so existing entities are not double-encoded into ambiguity', () => {
    // & must be replaced before < / > so that "<" becomes "&lt;" and not "&amp;lt;".
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('neutralises a stored-XSS payload (the search-highlight sink)', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('&gt;')
  })

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello, world 123 — fine')).toBe('Hello, world 123 — fine')
  })

  it('handles the empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})
