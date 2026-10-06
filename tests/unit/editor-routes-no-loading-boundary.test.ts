import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// A loading.tsx directly under editorial/(portal)/articles also wraps /new and /[id]/edit. That put the
// articles-list table skeleton on editor pages, and sent navigations to them through Next's optimistic
// loading-shell path, where the router's commit can be lost: the RSC request returns 200, the title
// updates, and the portal content area stays empty (<div class="portal-page-enter"></div>). Measured on
// the production build: 3 of 100 runs of the phone "New Article" test failed with the boundary there,
// 0 of 100 without it. The list's skeleton lives in the (list) route group so it wraps only the list.
const articles = join(process.cwd(), 'src/app/editorial/(portal)/articles')

it('keeps the editor routes free of a loading boundary', () => {
  expect(existsSync(join(articles, 'loading.tsx'))).toBe(false)
  expect(existsSync(join(articles, 'new/loading.tsx'))).toBe(false)
  expect(existsSync(join(articles, '[id]/edit/loading.tsx'))).toBe(false)
})

it('still gives the articles list its loading skeleton', () => {
  expect(existsSync(join(articles, '(list)/loading.tsx'))).toBe(true)
  expect(existsSync(join(articles, '(list)/page.tsx'))).toBe(true)
})
