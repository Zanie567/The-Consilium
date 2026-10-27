/**
 * The primary host is https://theconsilium.co.uk (docs/seo/primary-domain-switch.md). Canonical tags, the sitemap,
 * RSS and share links already use it; machine callers must too, because they do not follow redirects
 * (curl without -L; pg_net) and www redirects to the apex once the switch is made.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const workflows = readdirSync('.github/workflows').filter((f) => f.endsWith('.yml'))
const MIGRATION = readFileSync('supabase/migrations/20261025120000_publish_cron_apex_host.sql', 'utf8')

describe('primary host', () => {
  it('no scheduled workflow calls the www host', () => {
    for (const file of workflows) {
      const text = readFileSync(`.github/workflows/${file}`, 'utf8')
      expect(text, file).not.toMatch(/https:\/\/www\.theconsilium\.co\.uk/)
      for (const url of text.match(/https:\/\/[a-z.]*theconsilium\.co\.uk[^\s"']*/g) ?? []) {
        expect(/^https:\/\/theconsilium\.co\.uk(\/|$)/.test(url), `${file}: ${url}`).toBe(true)
      }
    }
  })

  it('the Supabase Cron migration swaps only the publish URL, idempotently, and refuses a hand-edited function', () => {
    expect(MIGRATION).toContain("old_url CONSTANT text := 'https://www.theconsilium.co.uk/api/publish-scheduled'")
    expect(MIGRATION).toContain("new_url CONSTANT text := 'https://theconsilium.co.uk/api/publish-scheduled'")
    expect(MIGRATION).toMatch(/EXECUTE replace\(def, quote_literal\(old_url\), quote_literal\(new_url\)\)/)
    expect(MIGRATION).toMatch(/already calls/)
    expect(MIGRATION).toMatch(/RAISE EXCEPTION 'invoke_publish_scheduled\(\) does not call/)
  })

  it('every fallback origin in the code is the apex', () => {
    expect(readFileSync('src/lib/constants.ts', 'utf8')).toContain("'https://theconsilium.co.uk'")
    expect(readFileSync('src/lib/shareUrl.ts', 'utf8')).toContain("let origin = 'https://theconsilium.co.uk'")
    expect(readFileSync('src/app/feed.xml/route.ts', 'utf8')).toContain("const SITE_URL = 'https://theconsilium.co.uk'")
  })
})
