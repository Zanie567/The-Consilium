import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * Crawls internal links and asserts no response (page OR RSC prefetch) returns
 * >= 400. Runs the same URL set BOTH single-threaded and concurrently to surface
 * the Priority 2 "503 under load / on ?_rsc= prefetch" issue.
 */

const SEED_PAGES = ['/', '/about', '/opinion-debate', '/archive', '/contact', '/category/opinion', '/category/analysis', '/category/news']

function internalLinks(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1]
    // Skip Next internals, assets, API, and auth-gated areas.
    if (/^\/(_next|api|editorial|admin|login|signup|profile|banned|reset-password|forgot-password)/.test(href)) continue
    if (/\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|xml|txt|woff2?|ttf)$/.test(href)) continue
    found.add(href)
  }
  return [...found]
}

async function collectUrls(request: APIRequestContext): Promise<string[]> {
  const urls = new Set<string>(SEED_PAGES)
  for (const page of SEED_PAGES) {
    const res = await request.get(page)
    if (res.ok()) internalLinks(await res.text()).forEach((u) => urls.add(u))
  }
  return [...urls].slice(0, 80) // safety cap
}

async function status(request: APIRequestContext, url: string, rsc: boolean): Promise<number> {
  const full = rsc ? `${url}${url.includes('?') ? '&' : '?'}_rsc=test${Math.random().toString(36).slice(2, 7)}` : url
  const res = await request.get(full, { headers: rsc ? { RSC: '1' } : {} })
  return res.status()
}

test('single-threaded crawl: no internal URL (page or ?_rsc=) returns >= 400', async ({ request }) => {
  const urls = await collectUrls(request)
  expect(urls.length).toBeGreaterThan(SEED_PAGES.length - 1)

  const failures: string[] = []
  for (const url of urls) {
    const s = await status(request, url, false)
    if (s >= 400) failures.push(`${url} -> ${s}`)
    const rscStatus = await status(request, url, true)
    if (rscStatus >= 400) failures.push(`${url}?_rsc -> ${rscStatus}`)
  }
  expect(failures, `bad responses:\n${failures.join('\n')}`).toEqual([])
})

test('concurrent crawl: bursts of page + ?_rsc= requests stay < 500', async ({ request }) => {
  const urls = await collectUrls(request)

  // Mix full renders and RSC prefetches into one concurrent burst, repeated, to
  // mimic a user hovering/navigating quickly (the prefetch-storm scenario).
  const jobs: Promise<{ url: string; status: number }>[] = []
  for (let round = 0; round < 3; round++) {
    for (const url of urls) {
      const rsc = (jobs.length & 1) === 0
      jobs.push(status(request, url, rsc).then((s) => ({ url: `${url}${rsc ? '?_rsc' : ''}`, status: s })))
    }
  }
  const results = await Promise.all(jobs)
  const serverErrors = results.filter((r) => r.status >= 500)
  expect(
    serverErrors,
    `5xx under concurrent load:\n${serverErrors.map((r) => `${r.url} -> ${r.status}`).join('\n')}`,
  ).toEqual([])

  // Also assert no 4xx on these public GETs (would indicate a broken link/route).
  const clientErrors = results.filter((r) => r.status >= 400 && r.status < 500)
  expect(clientErrors, `4xx under load:\n${clientErrors.map((r) => `${r.url} -> ${r.status}`).join('\n')}`).toEqual([])
})
