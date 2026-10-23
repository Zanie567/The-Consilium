import { describe, expect, it, vi } from 'vitest'
// Next's server runtime installs this global before loading its modules; do the same here.
vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
})
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external'
import { executeRevalidates } from 'next/dist/server/revalidation-utils'
import { expireCacheTag, settleCacheInvalidations } from '@/lib/cacheInvalidation'

type Store = Parameters<typeof workAsyncStorage.run>[0]

/** The minimum of Next's per-request work store that revalidateTag and executeRevalidates read. */
function fakeStore(write: (tags: string[]) => Promise<void>) {
  return {
    route: '/api/test',
    incrementalCache: { revalidateTag: vi.fn(write) },
    cacheLifeProfiles: {},
  } as unknown as Store
}

describe('cache invalidation is written before a mutation responds (Next 16.3+)', () => {
  it('the pinned Next still exposes the internals this relies on', () => {
    expect(typeof executeRevalidates).toBe('function')
    expect(typeof workAsyncStorage.getStore).toBe('function')
  })

  it('expireCacheTag resolves only after the cache write has completed', async () => {
    const events: string[] = []
    const store = fakeStore(async (tags) => {
      await new Promise((r) => setTimeout(r, 50)) // a slow cache backend
      events.push(`written:${tags.join(',')}`)
    })
    await workAsyncStorage.run(store, async () => {
      expect(await expireCacheTag('articles')).toBe(true)
      events.push('mutation responds')
    })
    expect(events).toEqual(['written:articles', 'mutation responds'])
  })

  it('a failed cache write is reported, not thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = fakeStore(async () => { throw new Error('cache backend down') })
    await workAsyncStorage.run(store, async () => {
      expect(await expireCacheTag('articles')).toBe(false)
    })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('outside a Next request nothing is queued and nothing throws', async () => {
    await expect(settleCacheInvalidations()).resolves.toBeUndefined()
  })

  it('every invalidation call in src is awaited', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    walk('src')
    const missing: string[] = []
    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/^\s*(\*|\/\*)/.test(line) || /\bfunction\s+(revalidateArticleLists|revalidateDebateSurfaces|expireCacheTag)\b/.test(code)) return
        for (const m of code.matchAll(/(^|[^\w.])(revalidateArticleLists|revalidateDebateSurfaces|expireCacheTag)\(/g)) {
          const before = code.slice(0, m.index! + m[1].length)
          if (!/(await|return)\s*\(?\s*$/.test(before)) missing.push(`${file}:${i + 1}`)
        }
      })
    }
    expect(missing).toEqual([])
  })

  it('every file that queues revalidatePath also waits for the queue to be written', () => {
    // revalidatePath only queues; since Next 16.3 the write happens after the response unless an
    // awaited expiry (or settleCacheInvalidations) in the same request writes it first.
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    walk('src')
    const unsettled = files.filter((file) => {
      const code = readFileSync(file, 'utf8')
      return /\brevalidatePath\(/.test(code) &&
        !/await\s+(settleCacheInvalidations|revalidateArticleLists|revalidateDebateSurfaces|expireCacheTag)\(/.test(code)
    })
    expect(unsettled).toEqual([])
  })
})
