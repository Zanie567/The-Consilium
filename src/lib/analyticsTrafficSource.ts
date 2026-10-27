// Referrer-based grouping is approximate. Missing referrals are not proof
// of a direct visit: email apps and privacy controls may suppress them.
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

export type TrafficSource = 'Direct / unknown' | 'Search' | 'Social' | 'Email' | 'Other'

export function classifyTrafficSource(source: string | null, referrer: string | null): TrafficSource {
  // Older events never populated the source field. Honour genuinely explicit
  // categories, but infer from referrers when the value is unset or 'Direct'.
  if (source === 'Search' || source === 'Social' || source === 'Email' || source === 'Other')
    return source
  if (!referrer) return 'Direct / unknown'
  try {
    const url = new URL(referrer)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Other'
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (OWN_HOSTS.some(d => isHost(host, d))) return 'Direct / unknown'
    if (SEARCH_HOSTS.some(d => isHost(host, d))) return 'Search'
    if (SOCIAL_HOSTS.some(d => isHost(host, d))) return 'Social'
    return 'Other'
  } catch {
    return 'Direct / unknown'
  }
}
