import { notFound } from 'next/navigation'

/**
 * Per-request twins of the CDN-cached public routes, used ONLY by testing-mode builds.
 *
 * In testing mode the root layout reads the session (testing banner, persona identity), and a
 * cached (ISR) route cannot read the session or cookies at request time. Segment config must be a
 * literal, so a page cannot switch caching off by environment; instead next.config.ts rewrites the
 * cached routes here when TESTING_MODE_ENABLED=1 at build time. Each twin re-exports the same page
 * code, so the testing workspace and the browser suite render exactly what production renders,
 * per request, as before. Outside testing mode every address here is a 404.
 * Pinned by tests/unit/public-page-caching.test.ts.
 */
export const dynamic = 'force-dynamic'

export default function TestingDynamicLayout({ children }: { children: React.ReactNode }) {
  if (process.env.TESTING_MODE_ENABLED !== '1') notFound()
  return children
}
