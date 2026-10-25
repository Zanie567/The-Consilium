// Vercel "Ignored Build Step" (vercel.json `ignoreCommand`): decides whether a deployment builds.
//
// Exit 1 = build. Exit 0 = skip: Vercel cancels the deployment before it builds, so it stores no
// function bundles (Functions Storage) and no build output (Deployment Storage). This file never
// decides production: every non-preview deployment builds, unconditionally.
//
// A PREVIEW is skipped only when one of these is true:
//   - its commit message contains "[skip preview]" or "[no preview]"; or
//   - every file changed since the branch's last successful deployment (or, for its first
//     deployment, since it left main) is outside the deployed site: tests, docs, CI workflows,
//     Supabase SQL (applied by hand, never by Vercel), backup/CI/diagnostic scripts and dev-only
//     config (see NON_RUNTIME_PATHS).
// "[preview]" in the commit message always builds. Anything this cannot determine (a shallow
// clone that cannot be deepened, a branch too old to find where it left main, any git error)
// builds.
//
// Replaying October 2026's 294 preview deployments through these rules skips 79 (27%), or 95 if
// the first-deployment comparison with main works; on Vercel's builder it did not (October 2026),
// so a branch's first deployment currently always builds. See docs/operations/vercel-hobby-resources.md.
// Get a preview for a skipped commit by pushing a commit whose message contains "[preview]", or
// with Redeploy in the Vercel dashboard (untick "Use project's Ignore Build Step").
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Paths that cannot change what Vercel builds or serves. Keep this list conservative. */
export const NON_RUNTIME_PATHS = [
  /^docs\//,
  /^tests\//,
  /^\.github\//,
  /^supabase\//,
  /^scripts\/(backup|ci|db|diagnostics|perf)\//,
  /^[^/]+\.md$/, // README.md, AGENTS.md, CLAUDE.md at the repository root
  /^playwright\.config\.ts$/,
  /^vitest(\.[a-z-]+)?\.config\.ts$/,
  /^eslint\.config\.mjs$/,
  /^knip\.json$/,
  /^\.gitignore$/,
  /^tsconfig\.seed\.json$/,
  /^prisma\/(seed[^/]*|dedupe-articles)\.ts$/,
]

export const isNonRuntimePath = (file) => NON_RUNTIME_PATHS.some((pattern) => pattern.test(file))

/**
 * @param {{ env: Record<string, string | undefined>, changedFiles: string[] | null }} input
 *   changedFiles: files changed since the branch's last successful deployment; null = unknown.
 * @returns {{ build: boolean, reason: string }}
 */
export function decide({ env, changedFiles }) {
  if (env.VERCEL_ENV !== 'preview') return { build: true, reason: `${env.VERCEL_ENV || 'unknown'} deployment: always built` }

  const message = env.VERCEL_GIT_COMMIT_MESSAGE ?? ''
  if (/\[preview\]/i.test(message)) return { build: true, reason: 'commit message asks for a preview ([preview])' }
  if (/\[(skip|no) preview\]/i.test(message)) return { build: false, reason: 'commit message asks to skip the preview' }

  if (changedFiles === null) return { build: true, reason: 'cannot tell what changed since the last deployment of this branch' }
  if (changedFiles.length === 0) return { build: false, reason: 'no file changes since the last deployment of this branch' }
  const runtime = changedFiles.filter((file) => !isNonRuntimePath(file))
  if (runtime.length === 0) {
    return { build: false, reason: `only tests, docs, CI or SQL changed (${changedFiles.length} file(s))` }
  }
  return { build: true, reason: `site files changed, e.g. ${runtime.slice(0, 3).join(', ')}` }
}

/** The Vercel projects' production branch (Settings > Git). */
export const PRODUCTION_BRANCH = 'main'

const defaultGit =(...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 })
const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

/**
 * Files changed since the branch's last successful deployment (VERCEL_GIT_PREVIOUS_SHA) or, on a
 * branch's first deployment, since it left the production branch. null = unknown (so it builds).
 */
export function changedSinceLastDeployment(env, git = defaultGit) {
  const previous = env.VERCEL_GIT_PREVIOUS_SHA
  try {
    if (previous) {
      if (!/^[0-9a-f]{7,40}$/i.test(previous)) return null
      try {
        git('cat-file', '-e', `${previous}^{commit}`)
      } catch {
        // Vercel clones shallowly; fetch just that commit. If this fails too, the outer catch builds.
        git('fetch', '--quiet', '--no-tags', '--depth=1', 'origin', previous)
      }
      return lines(git('diff', '--name-only', '--no-renames', previous, 'HEAD'))
    }
    // First deployment of this branch: compare with where it left the production branch. The
    // repository is public, so this fetch needs no credentials. Deepen both sides enough to find
    // the merge base of a recent branch; an older branch simply builds.
    const production = PRODUCTION_BRANCH
    git('fetch', '--quiet', '--no-tags', '--depth=200', 'origin', `+refs/heads/${production}:refs/remotes/origin/${production}`)
    try { git('fetch', '--quiet', '--no-tags', '--deepen=200', 'origin') } catch { /* complete clone already */ }
    const base = git('merge-base', `refs/remotes/origin/${production}`, 'HEAD').trim()
    if (!/^[0-9a-f]{40}$/.test(base)) return null
    return lines(git('diff', '--name-only', '--no-renames', base, 'HEAD'))
  } catch {
    return null
  }
}

function main() {
  let decision
  try {
    decision = decide({ env: process.env, changedFiles: process.env.VERCEL_ENV === 'preview' ? changedSinceLastDeployment(process.env) : null })
  } catch (error) {
    decision = { build: true, reason: `ignore step failed (${error instanceof Error ? error.message : error}); building` }
  }
  console.log(`vercel-ignore-build: ${decision.build ? 'BUILD' : 'SKIP'} - ${decision.reason}`)
  process.exit(decision.build ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
