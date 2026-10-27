// Referrer attribution is necessarily approximate: private apps, emails
// and privacy controls often suppress the referring origin.
const SEARCH_HOSTS = [
  'google.com', 'google.co.uk', 'bing.com', 'ecosia.org', 'duckduckgo.com',
  'yahoo.com', 'baidu.com',
]
const SOCIAL_HOSTS = [
  'instagram.com', 'linkedin.com', 'facebook.com', 'fb.com', 't.co',
  'twitter.com', 'x.com', 'reddit.com', 'tiktok.com', 'youtube.com',
]
const OWN_HOSTS = ['theconsilium.co.uk', 'the-consilium.vercel.app', 'localhost']

function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

function referrerHostname(referrer: string | null): string | null {
  if (!referrer) return null
  try {
    const url = new URL(referrer)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export type TrafficSource = 'Direct / unknown' | 'Internal' | 'Search' | 'Social' | 'Email' | 'Other'

export function classifyTrafficSource(source: string | null, referrer: string | null): TrafficSource {
  // A real referrer is preferable to a generic Direct/source value; old view
  // rows have NULL source, and internal navigation is not a new acquisition.
  const host = referrerHostname(referrer)
  if (host && OWN_HOSTS.some(d => isHost(host, d))) return 'Internal'
  if (source === 'Search' || source === 'Social' || source === 'Email' || source === 'Other')
    return source
  if (!host) return 'Direct / unknown'
  // Google sign-in (OAuth) isn't evidence of a Google Search referral;
  // similarly a Gmail referral is email rather than organic search.
  if (host === 'mail.google.com') return 'Email'
  if (host === 'accounts.google.com') return 'Other'
  if (SEARCH_HOSTS.some(d => d.startsWith('google.') ? host === d : isHost(host, d))) return 'Search'
  if (SOCIAL_HOSTS.some(d => isHost(host, d))) return 'Social'
  return 'Other'
}

// Expose useful external origins without paths, query strings or personal
// information. These labels are for acquisition insight, not unique visitors.
export function referrerLabel(referrer: string | null): string | null {
  const host = referrerHostname(referrer)
  if (!host || OWN_HOSTS.some(d => isHost(host, d))) return null
  if (host === 'accounts.google.com') return 'Google sign-in'
  if (host === 'mail.google.com') return 'Gmail'
  if (host === 'google.com' || host === 'google.co.uk') return 'Google'
  if (isHost(host, 'bing.com')) return 'Bing'
  if (isHost(host, 'ecosia.org')) return 'Ecosia'
  if (isHost(host, 'duckduckgo.com')) return 'DuckDuckGo'
  if (isHost(host, 'instagram.com')) return 'Instagram'
  if (isHost(host, 'linkedin.com')) return 'LinkedIn'
  if (isHost(host, 'facebook.com') || isHost(host, 'fb.com')) return 'Facebook'
  if (isHost(host, 'twitter.com') || isHost(host, 'x.com') || isHost(host, 't.co')) return 'X / Twitter'
  if (isHost(host, 'reddit.com')) return 'Reddit'
  if (isHost(host, 'tiktok.com')) return 'TikTok'
  if (isHost(host, 'youtube.com')) return 'YouTube'
  // Only the host is disclosed; never echo a full referrer URL.
  return host
}
