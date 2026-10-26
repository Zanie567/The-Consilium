import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// src/proxy.ts runs on every matched request. Modules that import Prisma build a database client as soon as they
// load, so the proxy must reach them only through a dynamic import() on the paths that need them (see #180).
const PRISMA_BACKED = ['@/lib/prisma', '@/lib/testingMode', '@/lib/articleRedirects']

function staticImports(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  return [...source.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
    .filter((m) => !/^\s*import\s+type\s/.test(m[0]))
    .map((m) => m[1])
}

describe('proxy keeps database modules out of its static imports', () => {
  it('src/proxy.ts imports no Prisma-backed module statically', () => {
    const imports = staticImports('src/proxy.ts')
    expect(imports.filter((m) => PRISMA_BACKED.includes(m))).toEqual([])
  })

  it('the path parser the proxy imports statically has no imports at all', () => {
    expect(staticImports('src/lib/articleRedirectPath.ts')).toEqual([])
  })

  it('the redirect lookup is still reached, lazily, for article paths', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8')
    expect(source).toContain("import('@/lib/articleRedirects')")
  })
})
