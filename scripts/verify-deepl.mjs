#!/usr/bin/env node
/**
 * Pre-launch check for the translation provider.
 *
 * Confirms, against the live API rather than against documentation, that:
 *   1. DEEPL_API_KEY authenticates;
 *   2. every `deeplTarget` in the application's locale allowlist is a code the
 *      account can actually translate into;
 *   3. English is an accepted source language;
 *   4. the remaining character allowance is known before any article is
 *      translated.
 *
 * Reads the key from the environment only, prints usage figures but never the
 * key, and translates nothing.
 *
 *   node --env-file=.env.local scripts/verify-deepl.mjs
 */

import { readFileSync } from 'node:fs'

const KEY = process.env.DEEPL_API_KEY?.trim()
if (!KEY) {
  console.error('DEEPL_API_KEY is not set. Add it to .env.local (server-only, never NEXT_PUBLIC_).')
  process.exit(1)
}

/**
 * Probes both hosts rather than trusting the ":fx" convention, which predates
 * the Developer plan. Reports the host that actually authenticates so it can be
 * pinned with DEEPL_API_HOST if it is not the one the convention would pick.
 */
async function resolveHost() {
  const conventional = KEY.endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com'
  const candidates = [conventional, 'https://api-free.deepl.com', 'https://api.deepl.com']
  const tried = new Set()
  for (const host of candidates) {
    if (tried.has(host)) continue
    tried.add(host)
    try {
      const response = await fetch(`${host}/v2/usage`, {
        headers: { Authorization: `DeepL-Auth-Key ${KEY}` },
      })
      if (response.ok) {
        if (host !== conventional) {
          console.warn(
            `NOTE: this key authenticates against ${host}, not the ${conventional} ` +
              `implied by its suffix. Set DEEPL_API_HOST=${host} in the environment.`
          )
        }
        return host
      }
      if (response.status !== 403 && response.status !== 401) {
        throw new Error(`${host}/v2/usage responded ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      if (error instanceof TypeError) continue
      throw error
    }
  }
  throw new Error('The key was rejected by both api.deepl.com and api-free.deepl.com.')
}

const BASE = process.env.DEEPL_API_HOST?.trim() || (await resolveHost())

/** Reads the allowlist out of the TypeScript source so the two cannot drift. */
function expectedTargets() {
  const source = readFileSync(new URL('../src/lib/translation/locales.ts', import.meta.url), 'utf8')
  const targets = [...source.matchAll(/deeplTarget:\s*'([^']+)'/g)].map((m) => m[1])
  if (targets.length === 0) throw new Error('no deeplTarget entries found in locales.ts')
  return targets
}

async function api(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `DeepL-Auth-Key ${KEY}` },
  })
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status} ${response.statusText}`)
  }
  return response.json()
}

const problems = []

console.log(`Endpoint: ${BASE}`)

const usage = await api('/v2/usage')
const used = usage.character_count ?? 0
const limit = usage.character_limit ?? 0
console.log(
  `Usage:    ${used.toLocaleString()} / ${limit.toLocaleString()} characters ` +
    `(${limit ? (((limit - used) / limit) * 100).toFixed(1) : '?'}% remaining)`
)

const targets = await api('/v2/languages?type=target')
const sources = await api('/v2/languages?type=source')
const targetCodes = new Set(targets.map((l) => l.language))
const sourceCodes = new Set(sources.map((l) => l.language))

if (!sourceCodes.has('EN')) problems.push('EN is not an accepted source language')

console.log('\nTarget languages required by src/lib/translation/locales.ts:')
for (const code of expectedTargets()) {
  const entry = targets.find((l) => l.language === code)
  if (entry) {
    console.log(`  OK   ${code.padEnd(8)} ${entry.name}`)
  } else {
    problems.push(`target_lang "${code}" is not offered by this account`)
    console.log(`  FAIL ${code.padEnd(8)} not offered`)
  }
}

if (problems.length > 0) {
  console.error('\nProblems found:')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\nSupported codes (target):',
    [...targetCodes].sort().join(', ')
  )
  process.exit(1)
}

console.log('\nAll configured language codes are supported by this account.')
