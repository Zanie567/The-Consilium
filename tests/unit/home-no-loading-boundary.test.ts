import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// A loading.tsx beside the home page makes its ?category= tab navigations take Next's optimistic
// loading-shell path, where the router's commit (and the URL update) can be lost under CPU load: the
// RSC request returns 200 and nothing happens. Measured on the production build with the instrumented
// router: 3-6 lost clicks per 150 rounds with the boundary, 0 in 300 without it. See the comment in
// src/app/(home)/page.tsx before adding one back.
it('keeps the home page free of a loading boundary', () => {
  expect(existsSync(join(process.cwd(), 'src/app/(home)/loading.tsx'))).toBe(false)
})
