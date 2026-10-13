/**
 * "Check access": the pages and APIs a test persona should and should not be able to reach, and
 * how to judge the result. The browser runs the requests as the active persona (the testing
 * capability cookie rides along), so this exercises the real server-side enforcement, not a
 * simulation. Expected-allowed pages come from the same navigation definition the sidebar uses;
 * expected-denied ones are the administrator-only destinations.
 */
import { navHrefs } from '@/lib/adminNav'
import { PERSONA_ROLES, type TestPersona } from '@/lib/testingSessionConstants'

export interface Probe {
  kind: 'page' | 'api'
  url: string
  expect: 'allowed' | 'denied'
  label: string
}

export interface ProbeResult {
  status: number
  /** Pathname after any redirects. */
  finalPath: string
  /** The start of the response body, for the "Access Denied" / "not found" screens. */
  bodyText: string
}

const ADMIN_PAGES = [
  { url: '/editorial/members', label: 'Team Members' },
  { url: '/editorial/users', label: 'Users' },
  { url: '/admin/login-attempts', label: 'Login Attempts' },
  { url: '/admin/data', label: 'Data Management' },
]
const ADMIN_APIS = [
  { url: '/api/admin/team-members', label: 'Team Members directory' },
  { url: '/api/admin/audit-log', label: 'Audit log' },
  { url: '/api/admin/deployment-health', label: 'Deployment health' },
]

const pathOf = (href: string) => href.split('?')[0]

/** Pages from the persona's own menu are expected to open; administrator-only ones are not. */
export function probesFor(persona: TestPersona): Probe[] {
  const role = PERSONA_ROLES[persona]
  const menu = new Set(navHrefs({ role }).map(pathOf))
  const allowed: Probe[] = [...menu]
    // The Testing page belongs to the administrator behind the session, so it is not a persona probe.
    .filter((url) => url !== '/admin/testing')
    .map((url) => ({ kind: 'page' as const, url, expect: 'allowed' as const, label: `${url} (in this role’s menu)` }))
  const deniedPages: Probe[] = ADMIN_PAGES.filter((p) => !menu.has(p.url)).map((p) => ({
    kind: 'page', url: p.url, expect: 'denied', label: `${p.label} (administrators only)`,
  }))
  const deniedApis: Probe[] = ADMIN_APIS.map((p) => ({ kind: 'api', url: p.url, expect: 'denied', label: `${p.label} API (administrators only)` }))
  return [...allowed, ...deniedPages, ...deniedApis]
}

const REFUSAL = /Access Denied|This page could not be found|404/i

/** True when the response is a refusal: an error status, a redirect elsewhere, or an access-denied screen. */
export function wasRefused(probe: Pick<Probe, 'kind' | 'url'>, result: ProbeResult): boolean {
  if (result.status >= 400) return true
  if (probe.kind === 'api') return false
  return result.finalPath !== pathOf(probe.url) || REFUSAL.test(result.bodyText)
}

export function judgeProbe(probe: Probe, result: ProbeResult): { pass: boolean; detail: string } {
  const refused = wasRefused(probe, result)
  const pass = probe.expect === 'denied' ? refused : !refused
  const detail = refused
    ? result.status >= 400 ? `refused (${result.status})` : `refused (sent to ${result.finalPath})`
    : `opened (${result.status})`
  return { pass, detail }
}
