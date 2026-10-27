'use client'

import { useState } from 'react'

const SOURCE_OPTIONS = [
  { value: 'instagram', label: 'Instagram', medium: 'social' },
  { value: 'linkedin', label: 'LinkedIn', medium: 'social' },
  { value: 'whatsapp', label: 'WhatsApp', medium: 'social' },
  { value: 'newsletter', label: 'Newsletter', medium: 'email' },
  { value: 'society_partner', label: 'University society', medium: 'referral' },
  { value: 'other', label: 'Other / custom', medium: 'referral' },
]
const VALID_LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function createCampaignUrl(
  path: string,
  source: string,
  medium: string,
  campaign: string,
  content: string
): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) return null
  if (![source, medium, campaign].every(label => VALID_LABEL.test(label)) ||
    (content && !VALID_LABEL.test(content))) return null
  const url = new URL(path, 'https://theconsilium.co.uk')
  if (url.origin !== 'https://theconsilium.co.uk') return null
  url.searchParams.set('utm_source', source)
  url.searchParams.set('utm_medium', medium)
  url.searchParams.set('utm_campaign', campaign)
  if (content) url.searchParams.set('utm_content', content)
  return url.toString()
}

export function CampaignLinkBuilder({ articles }: {
  articles: { id: string; title: string; slug: string }[]
}) {
  const [path, setPath] = useState('/')
  const [source, setSource] = useState('instagram')
  const [medium, setMedium] = useState('social')
  const [campaign, setCampaign] = useState('')
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState(false)

  const slug = (raw: string) => raw.toLowerCase().trim().replace(/\s+/g, '_')
  const url = createCampaignUrl(path, source, medium, slug(campaign), slug(content))
  const fieldClass = 'w-full bg-[var(--bg-elevated)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--fg)] focus:outline-none focus:border-gold'
  const onSource = (next: string) => {
    const option = SOURCE_OPTIONS.find(item => item.value === next)
    setSource(next)
    if (option) setMedium(option.medium)
    setCopied(false)
  }
  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <p className="text-xs text-[var(--fg-muted)]">
        Generate a separate URL for every promotion. Use lowercase identifiers such as
        <span className="font-semibold"> week_02</span> and <span className="font-semibold">story_01</span>.
        Do not enter names, email addresses or other personal information.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1 text-xs text-[var(--fg-muted)]">
          <span className="font-semibold uppercase tracking-wide">Destination</span>
          <select className={fieldClass} value={path} onChange={e => {setPath(e.target.value);setCopied(false)}}>
            <option value="/">Homepage</option>
            <option value="/trading-challenge">Trading Challenge</option>
            {articles.map(article => (
              <option key={article.id} value={`/articles/${article.slug}`}>{article.title}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--fg-muted)]">
          <span className="font-semibold uppercase tracking-wide">Platform / source</span>
          <select className={fieldClass} value={source} onChange={e => onSource(e.target.value)}>
            {SOURCE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-[var(--fg-muted)]">
          <span className="font-semibold uppercase tracking-wide">Campaign name</span>
          <input className={fieldClass} value={campaign} maxLength={64}
            onChange={e => {setCampaign(e.target.value);setCopied(false)}}
            placeholder="weekly_edition_02" />
        </label>
        <label className="space-y-1 text-xs text-[var(--fg-muted)]">
          <span className="font-semibold uppercase tracking-wide">Post / creative (optional)</span>
          <input className={fieldClass} value={content} maxLength={64}
            onChange={e => {setContent(e.target.value);setCopied(false)}}
            placeholder="sanctions_story_01" />
        </label>
      </div>
      {url ? (
        <div className="space-y-2">
          <p className="font-mono text-xs break-all p-3 bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--fg)]">{url}</p>
          <button type="button" onClick={copy}
            className="bg-navy text-gold px-4 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark">
            {copied ? 'Copied link' : 'Copy campaign link'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--fg-faint)]">
          Enter a campaign name using letters, numbers, underscores or hyphens to generate a shareable link.
        </p>
      )}
    </div>
  )
}
