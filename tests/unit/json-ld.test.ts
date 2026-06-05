import { describe, it, expect } from 'vitest'
import { safeJsonLd } from '@/lib/jsonLd'

describe('safeJsonLd', () => {
  it('produces valid JSON that parses back to the original object', () => {
    const data = { '@type': 'Article', headline: 'Normal title', n: 1, b: true }
    expect(JSON.parse(safeJsonLd(data))).toEqual(data)
  })

  it('neutralises a </script> breakout in a string value (the JSON-LD sink)', () => {
    const data = { headline: 'Econ </script><script>alert(document.cookie)</script>' }
    const out = safeJsonLd(data)
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(JSON.parse(out).headline).toBe('Econ </script><script>alert(document.cookie)</script>')
  })

  it('escapes < > & and the U+2028/U+2029 line separators', () => {
    const input = '<>&  '
    const out = safeJsonLd({ s: input })
    expect(out).toContain('\\u003c')
    expect(out).toContain('\\u003e')
    expect(out).toContain('\\u0026')
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(JSON.parse(out).s).toBe(input)
  })

  it('handles an HTML-comment breakout attempt', () => {
    const out = safeJsonLd({ s: '<!--<script>' })
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('<script>')
  })
})
