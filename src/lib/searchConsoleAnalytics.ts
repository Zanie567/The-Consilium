import { createSign } from 'node:crypto'

/**
 * Read-only Search Console statistics, never user identifiers.
 * Production credentials belong exclusively in encrypted server environment
 * variables. Do not add Google OAuth scopes to reader or editorial sign-in.
 */
export type SearchMetric = {
  label: string; clicks: number; impressions: number; ctr: number; position: number
}
export type SearchConsoleData = {
  status: 'connected'
  property: string
  startDate: string; endDate: string
  requestedPeriod: '7d' | '30d' | '90d'
  retrievedAt: string
  summary: { clicks: number; impressions: number; ctr: number; position: number }
  comparison: { clicks: number; impressions: number; changePct: number | null }
  topQueries: SearchMetric[]
  topPages: SearchMetric[]
  devices: SearchMetric[]
  daily: SearchMetric[]
  opportunities: Array<SearchMetric & { reason: string }>
}
export type SearchResult = SearchConsoleData |
  { status: 'not_connected'; message: string } |
  { status: 'unavailable'; message: string }

type SearchRow = {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}
type SearchResponse = { rows?: SearchRow[] }
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly'
const TOKEN_TIMEOUT_MS = 8000
const cache = new Map<string, { until: number; result: SearchConsoleData }>()
const DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 }

function isoDate(date: Date): string { return date.toISOString().slice(0, 10) }
function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000)
}
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}
export function summariseRow(row?: SearchRow) {
  return {
    clicks: safeNumber(row?.clicks),
    impressions: safeNumber(row?.impressions),
    ctr: safeNumber(row?.ctr),
    position: safeNumber(row?.position),
  }
}
function projectRows(rows: SearchRow[] | undefined): SearchMetric[] {
  return (rows ?? []).map(row => ({
    label: String(row.keys?.[0] ?? ''),
    ...summariseRow(row),
  })).filter(row => row.label.length > 0)
}
export function comparePct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round((current - previous) / previous * 100)
}
export function findSearchOpportunities(rows: SearchMetric[]) {
  // A conservative, explicitly heuristic shortlist; not a promise of uplift.
  return rows.filter(row =>
    row.impressions >= 20 && row.position >= 4 && row.position <= 20 && row.ctr < 0.05
  ).sort((a, b) => b.impressions - a.impressions).slice(0, 8)
    .map(row => ({
      ...row,
      reason: 'Visible in search, but few clicks relative to impressions; review title and search snippet',
    }))
}

function config() {
  const email = process.env.GSC_SERVICE_ACCOUNT_EMAIL?.trim()
  const privateKey = process.env.GSC_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const property = process.env.GSC_PROPERTY?.trim()
  if (!email || !privateKey || !property) return null
  // The panel is tied specifically to the official Consilium property.
  if (!['sc-domain:theconsilium.co.uk', 'https://theconsilium.co.uk/', 'https://www.theconsilium.co.uk/'].includes(property)) {
    throw new Error('Search Console property does not match the official domain')
  }
  return { email, privateKey, property }
}

function serviceJwt(email: string, key: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: email, scope: SCOPES, aud: GOOGLE_TOKEN, iat: now, exp: now + 3000,
  })).toString('base64url')
  const unsigned = header + '.' + payload
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')
  return unsigned + '.' + signature
}

async function accessToken(email: string, key: string) {
  const assertion = serviceJwt(email, key)
  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('Google authentication failed')
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('access_token' in body) ||
    typeof body.access_token !== 'string') throw new Error('Google returned an invalid access token')
  return body.access_token
}

async function querySearch(
  property: string, token: string, startDate: string, endDate: string,
  dimensions: string[], rowLimit: number,
): Promise<SearchResponse> {
  const endpoint = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(property) + '/searchAnalytics/query'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, type: 'web', dataState: 'final' }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  // Never pass token, response body or account details into client errors/logs.
  if (!response.ok) throw new Error('Search Console query failed (access, quota or upstream error)')
  const json: unknown = await response.json()
  if (json === null || typeof json !== 'object') throw new Error('Invalid Search Console response')
  return json as SearchResponse
}

export async function getSearchConsoleReport(
  selected: string,
): Promise<SearchResult> {
  let credentials: ReturnType<typeof config>
  try { credentials = config() } catch { return { status: 'unavailable', message: 'Search Console property configuration is invalid.' } }
  if (!credentials) {
    return {
      status: 'not_connected',
      message: 'A Search Console read-only service account has not been configured. No search metrics are displayed.',
    }
  }
  // Google's finalized Search data typically trails current day by 2-3 days.
  const end = addUtcDays(new Date(Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
  )), -3)
  const period: '7d' | '30d' | '90d' = selected === '24h' ? '7d' : selected === '7d' || selected === '90d' ? selected : '30d'
  const start = addUtcDays(end, 1 - DAYS[period])
  const priorEnd = addUtcDays(start, -1)
  const priorStart = addUtcDays(priorEnd, 1 - DAYS[period])
  const key = credentials.property + ':' + period + ':' + isoDate(end)
  const existing = cache.get(key)
  if (existing && existing.until > Date.now()) return existing.result
  try {
    const token = await accessToken(credentials.email, credentials.privateKey)
    // Separate property-level summary from page/query rows: these aggregates
    // can differ because Search Console anonymises and truncates query rows.
    const [current, prior, queries, pages, devices, daily] = await Promise.all([
      querySearch(credentials.property, token, isoDate(start), isoDate(end), [], 1),
      querySearch(credentials.property, token, isoDate(priorStart), isoDate(priorEnd), [], 1),
      querySearch(credentials.property, token, isoDate(start), isoDate(end), ['query'], 80),
      querySearch(credentials.property, token, isoDate(start), isoDate(end), ['page'], 80),
      querySearch(credentials.property, token, isoDate(start), isoDate(end), ['device'], 10),
      querySearch(credentials.property, token, isoDate(start), isoDate(end), ['date'], 90),
    ])
    const summary = summariseRow(current.rows?.[0])
    const earlier = summariseRow(prior.rows?.[0])
    const topPages = projectRows(pages.rows).filter(row => {
      try {
        const u = new URL(row.label)
        return u.protocol === 'https:' &&
          ['theconsilium.co.uk', 'www.theconsilium.co.uk'].includes(u.hostname)
      } catch { return false }
    })
    const result: SearchConsoleData = {
      status: 'connected',
      property: credentials.property,
      startDate: isoDate(start), endDate: isoDate(end),
      requestedPeriod: period,
      retrievedAt: new Date().toISOString(),
      summary,
      comparison: { clicks: earlier.clicks, impressions: earlier.impressions,
        changePct: comparePct(summary.clicks, earlier.clicks) },
      topQueries: projectRows(queries.rows).slice(0, 15),
      topPages: topPages.slice(0, 15),
      devices: projectRows(devices.rows),
      daily: projectRows(daily.rows),
      opportunities: findSearchOpportunities(topPages),
    }
    if (cache.size >= 12) cache.clear()
    cache.set(key, { result, until: Date.now() + 2 * 60 * 60 * 1000 })
    return result
  } catch {
    return {
      status: 'unavailable',
      message: 'Search Console is configured but data could not be retrieved. Check property permission and Google API access.',
    }
  }
}
