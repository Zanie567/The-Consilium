/**
 * One arrival per in-memory document lifetime. We intentionally do not create
 * a persistent session identifier for readers who decline optional storage.
 * A reload is a new entry; SPA navigation is not a new acquisition.
 */
export interface LandingAttribution {
  entryKind: 'entry' | 'internal'
  referrer: string | null
  campaignSource?: string
  campaignMedium?: string
  campaignName?: string
  campaignContent?: string
}

let firstPublicPage = true

function safeLabel(input: string | null): string | undefined {
  if (!input || input.length > 64) return undefined
  // Lowercase identifiers, not arbitrary URLs, emails or free-text visitor data.
  const label = input.toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(label) ? label : undefined
}

export function landingAttribution(
  referrer: string,
  search: string
): LandingAttribution {
  const entryKind = firstPublicPage ? 'entry' : 'internal'
  firstPublicPage = false
  if (entryKind === 'internal')
    return { entryKind, referrer: null }

  const params = new URLSearchParams(search)
  const campaignSource = safeLabel(params.get('utm_source'))
  const campaignMedium = safeLabel(params.get('utm_medium'))
  const campaignName = safeLabel(params.get('utm_campaign'))
  const campaignContent = safeLabel(params.get('utm_content'))
  // An incomplete or mistyped campaign tag is not a valid attribution.
  const validCampaign = campaignSource && campaignMedium && campaignName
  return {
    entryKind,
    referrer: referrer || null,
    ...(validCampaign ? {
      campaignSource,
      campaignMedium,
      campaignName,
      ...(campaignContent ? { campaignContent } : {}),
    } : {}),
  }
}

export function noteUntrackedInitialRoute() {
  // Do not report an arrival from authentication or editorial pages as a
  // new public acquisition if navigation later reaches the public website.
  if (firstPublicPage) firstPublicPage = false
}
