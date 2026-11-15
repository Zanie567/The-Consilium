import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPTIMISED_IMAGE_HOSTS, coverImageSource, hasDisplayableCover, isOptimisedImageHost } from '@/lib/coverImageSource'

describe('coverImageSource', () => {
  it('treats a missing or blank cover as "none", not as an error', () => {
    for (const value of [null, undefined, '', '   ']) expect(coverImageSource(value)).toEqual({ kind: 'none' })
  })

  it('sends uploads and the other allow-listed hosts through the image optimiser', () => {
    for (const src of [
      'https://abcdefgh.supabase.co/storage/v1/object/public/article-images/u/1.jpg',
      'https://images.unsplash.com/photo-1?w=1200&q=80',
      'https://lh3.googleusercontent.com/a/photo',
      '/team/sam-hunt.png',
    ]) {
      expect(coverImageSource(src)).toEqual({ kind: 'optimised', src })
    }
  })

  it('trims the stored value', () => {
    expect(coverImageSource('  /team/a.png ')).toEqual({ kind: 'optimised', src: '/team/a.png' })
  })

  it('loads any other https image directly, because the optimiser would answer 400 for its host', () => {
    expect(coverImageSource('https://example.org/cover.jpg')).toEqual({ kind: 'direct', src: 'https://example.org/cover.jpg' })
    // A look-alike host is not the allow-listed one.
    expect(coverImageSource('https://images.unsplash.com.evil.test/x.jpg').kind).toBe('direct')
    expect(coverImageSource('https://a.b.supabase.co/x.jpg').kind).toBe('direct')
    expect(coverImageSource('https://supabase.co/x.jpg').kind).toBe('direct')
  })

  it('loads plain http directly (the local storage emulator in tests)', () => {
    expect(coverImageSource('http://127.0.0.1:54321/storage/x.png').kind).toBe('direct')
  })

  it('never produces an address for a value that cannot be an image URL', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'not a url',
      '//evil.test/x.png',
      '/\\evil.test/x.png',
      'ftp://example.org/x.png',
      'https://user:pass@example.org/x.png',
      `https://example.org/${'a'.repeat(2100)}`,
    ]) {
      expect(coverImageSource(value), value.slice(0, 40)).toEqual({ kind: 'invalid' })
      expect(hasDisplayableCover(value)).toBe(false)
    }
  })

  it('hasDisplayableCover is true only for an address a browser could load', () => {
    expect(hasDisplayableCover('https://example.org/cover.jpg')).toBe(true)
    expect(hasDisplayableCover('/team/a.png')).toBe(true)
    expect(hasDisplayableCover(null)).toBe(false)
  })
})

describe('optimiser host allowlist', () => {
  it('matches exactly one subdomain label for a wildcard, like next.config remotePatterns', () => {
    expect(isOptimisedImageHost('project.supabase.co')).toBe(true)
    expect(isOptimisedImageHost('PROJECT.SUPABASE.CO')).toBe(true)
    expect(isOptimisedImageHost('supabase.co')).toBe(false)
    expect(isOptimisedImageHost('a.b.supabase.co')).toBe(false)
    expect(isOptimisedImageHost('evilsupabase.co')).toBe(false)
  })

  // The component decides in the browser whether /_next/image may fetch a host. If this list and
  // next.config.ts disagree, an allowed host loads unoptimised (slow) or a disallowed one is sent
  // to the optimiser and breaks (400).
  it('is the same list as images.remotePatterns in next.config.ts', () => {
    const config = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')
    const block = config.slice(config.indexOf('remotePatterns: ['), config.indexOf('...(localStorage', config.indexOf('remotePatterns: [')))
    const hosts = [...block.matchAll(/hostname: '([^']+)'/g)].map((m) => m[1])
    expect(hosts.length).toBeGreaterThan(0)
    expect([...hosts].sort()).toEqual([...OPTIMISED_IMAGE_HOSTS].sort())
  })
})
