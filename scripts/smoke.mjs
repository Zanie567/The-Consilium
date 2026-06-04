#!/usr/bin/env node
/**
 * Read-only smoke test for the authorization contract of the routes touched in
 * the code-quality remediation. Runs against a live dev server and issues ONLY
 * GET requests — it never mutates data, so it is safe against any environment.
 *
 * Usage:
 *   npm run dev                                          # terminal 1 (needs .env.local)
 *   npm run smoke                                        # unauthenticated guards only
 *   SMOKE_COOKIE='next-auth.session-token=…' SMOKE_ROLE=ADMIN npm run smoke
 *
 * SMOKE_COOKIE: log in, then DevTools → Application → Cookies → copy the session
 *   cookie as `next-auth.session-token=<value>`.
 * SMOKE_ROLE:   that user's role — ADMIN | EDITOR | WRITER | GROWTH | READER.
 * SMOKE_BASE_URL defaults to http://localhost:3000.
 *
 * Exit code: 0 if every check passes, 1 if any fails, 2 if the server is unreachable.
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000'
const COOKIE = process.env.SMOKE_COOKIE ?? ''
const ROLE = (process.env.SMOKE_ROLE ?? '').toUpperCase()

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ${green('✓')} ${name}`)
  } catch (err) {
    failed += 1
    console.log(`  ${red('✗')} ${name}`)
    console.log(`      ${red(err.message)}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function get(path, withCookie = false) {
  return fetch(`${BASE}${path}`, {
    headers: withCookie && COOKIE ? { Cookie: COOKIE } : {},
    redirect: 'manual',
  })
}

async function main() {
  console.log(`\nSmoke test → ${BASE}\n`)

  try {
    await fetch(`${BASE}/api/articles`, { signal: AbortSignal.timeout(4000) })
  } catch {
    console.log(red(`Cannot reach ${BASE}. Start the app with \`npm run dev\` first.\n`))
    process.exit(2)
  }

  // ── Unauthenticated: protected routes reject, public routes work ──
  console.log('Unauthenticated guards:')
  await check('GET /api/articles → 200, only PUBLISHED, no author secrets (P0 guard)', async () => {
    const res = await get('/api/articles')
    assert(res.status === 200, `expected 200, got ${res.status}`)
    const list = await res.json()
    if (Array.isArray(list)) {
      for (const a of list) {
        assert(a.status === 'PUBLISHED', `leaked non-published status ${a.status}`)
        if (!a.author) continue
        for (const f of ['password', 'email', 'isBanned', 'failedLoginAttempts', 'lockedUntil']) {
          assert(!(f in a.author), `author.${f} leaked to anonymous caller`)
        }
      }
    }
  })
  await check('GET /api/articles?status=DRAFT → 401 (role guard)', async () => {
    assert((await get('/api/articles?status=DRAFT')).status === 401, 'drafts not protected')
  })
  await check('GET /api/editorial/analytics → 401 (authz conversion)', async () => {
    assert((await get('/api/editorial/analytics?period=30d&tab=overview')).status === 401, 'analytics not protected')
  })
  await check('GET /api/user/streak → 401 (authz conversion)', async () => {
    assert((await get('/api/user/streak')).status === 401, 'streak not protected')
  })
  for (const path of ['/api/editorial/users', '/api/editorial/trash', '/api/admin/users']) {
    await check(`GET ${path} → 401/403`, async () => {
      const s = (await get(path)).status
      assert([401, 403].includes(s), `expected 401/403, got ${s}`)
    })
  }
  await check('GET /api/search?q=ai → 200 array', async () => {
    const res = await get('/api/search?q=ai')
    assert(res.status === 200, `expected 200, got ${res.status}`)
    assert(Array.isArray(await res.json()), 'expected an array')
  })

  // ── Authenticated: the role contract for the converted routes ──
  const roleGates = [
    { path: '/api/editorial/analytics?period=30d&tab=overview', allow: ['ADMIN', 'GROWTH'] },
    { path: '/api/editorial/users', allow: ['ADMIN', 'EDITOR'] },
    { path: '/api/editorial/trash', allow: ['ADMIN', 'EDITOR', 'WRITER'] },
    { path: '/api/articles?status=DRAFT', allow: ['ADMIN', 'EDITOR', 'WRITER'] },
    { path: '/api/admin/users', allow: ['ADMIN'] },
    { path: '/api/user/streak', allow: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] },
    { path: '/api/user/achievements', allow: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] },
    { path: '/api/user/trophies', allow: ['ADMIN', 'EDITOR', 'WRITER', 'GROWTH', 'READER'] },
  ]

  console.log('\nAuthenticated role contract:')
  if (!COOKIE) {
    console.log(dim('  (skipped — set SMOKE_COOKIE and SMOKE_ROLE to run these)'))
  } else if (!ROLE) {
    console.log(red('  SMOKE_COOKIE set but SMOKE_ROLE missing — cannot evaluate the role contract.'))
    failed += 1
  } else {
    console.log(dim(`  as role: ${ROLE}`))
    for (const { path, allow } of roleGates) {
      const allowed = allow.includes(ROLE)
      await check(`GET ${path} → ${allowed ? '200' : '401/403'}`, async () => {
        const s = (await get(path, true)).status
        if (allowed) assert(s === 200, `expected 200 for ${ROLE}, got ${s}`)
        else assert([401, 403].includes(s), `expected 401/403 for ${ROLE}, got ${s}`)
      })
    }
  }

  console.log(`\n${failed === 0 ? green('PASS') : red('FAIL')} — ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.log(red(err.stack ?? String(err)))
  process.exit(2)
})
