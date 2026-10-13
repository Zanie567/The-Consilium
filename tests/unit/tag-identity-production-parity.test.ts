/**
 * The tag identity the application computes in JavaScript (canonicalTagSlug) must equal the one the
 * database computes (public.consilium_tag_identity, created by migration 20261006153514). A unique
 * index on the SQL value is what stops duplicate topics, so any disagreement makes saves fail or
 * duplicates slip through.
 *
 * The expected values below were NOT produced by this repository's code. They are what the
 * PRODUCTION Supabase server (Postgres 17.6, UTF8, en_US.UTF-8, Linux) returned on 2026-10-08 when the
 * function's exact expression was run inline in a read-only SELECT, before the migration existed.
 * After the migration was applied (2026-10-09) the same 25 labels were run through the deployed
 * public.consilium_tag_identity() in a read-only SELECT: 25 of 25 matched these values.
 * The expression the function evaluates:
 *
 *   trim(both '-' from regexp_replace(replace(replace(lower(normalize(label, NFKC)),
 *        U&'i\0307', 'i'), U&'\03C2', U&'\03C3'), '[^[:alnum:]]+', '-', 'g'))
 *
 * Why it matters: case-mapping and [:alnum:] come from the server's C library. A developer laptop
 * (macOS) disagrees with production on 'ὈΔΥΣΣΕΎΣ', so a local database cannot be trusted for this
 * check; the production server's own answers can.
 */
import { describe, it, expect } from 'vitest'
import { canonicalTagSlug } from '@/lib/tagIdentity'

const PRODUCTION: [label: string, slug: string][] = [
  ['Finance', 'finance'],
  [' Investment & Finance ', 'investment-finance'],
  ['INVESTMENT---FINANCE', 'investment-finance'],
  ['Ｆｉｎａｎｃｅ', 'finance'],
  ['Économie', 'économie'],
  ['İnflation', 'inflation'],
  ['ΟΣ', 'οσ'],
  ['ὈΔΥΣΣΕΎΣ', 'ὀδυσσεύσ'],
  ['中文', '中文'],
  ['Trade/Policy', 'trade-policy'],
  ['a_b-c d', 'a-b-c-d'],
  ['ﬁnance', 'finance'],
  ['Straße', 'straße'],
  ['NAÏVE café', 'naïve-café'],
  ['  --x--  ', 'x'],
  ['AI & ML (2026)', 'ai-ml-2026'],
  ['Q3 results', 'q3-results'],
  ['日本語 market', '日本語-market'],
  ['économie', 'économie'],
  ['Ǆ', 'dž'],
  ['ǅ', 'dž'],
  ['KELVIN', 'kelvin'],
  ['ⅷ', 'viii'],
  ['①②③', '123'],
  ['MiXeD CaSe', 'mixed-case'],
]

describe('tag identity: JavaScript equals what the production database computes', () => {
  it.each(PRODUCTION)('%j -> %j', (label, slug) => {
    expect(canonicalTagSlug(label)).toBe(slug)
  })
})
