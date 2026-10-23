/**
 * Svix/Resend webhook signature verification, newsletter markup safety, and the in-memory provider's
 * recipient model (which the DB tests rely on to prove who a broadcast would reach).
 */
import { describe, expect, it } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { verifyWebhookSignature } from '@/lib/newsletter/webhooks'
import { renderNewsletterHtml, renderNewsletterText, UNSUBSCRIBE_PLACEHOLDER } from '@/lib/newsletter/render'
import { createMemoryProvider } from '@/lib/newsletter/provider'
import type { EditionItem } from '@/lib/newsletter/edition'

const KEY = randomBytes(24)
const SECRET = `whsec_${KEY.toString('base64')}`

function sign(id: string, timestamp: number, body: string, key = KEY) {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

function headers(values: Record<string, string>) {
  return new Headers(values)
}

describe('webhook signature', () => {
  const body = JSON.stringify({ type: 'contact.updated', data: { email: 'a@b.co', unsubscribed: true } })
  const now = Date.UTC(2026, 9, 23, 12, 0, 0)
  const ts = Math.floor(now / 1000)

  it('accepts a correctly signed, fresh delivery', () => {
    const result = verifyWebhookSignature(body, headers({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_1', ts, body) }), [SECRET], now)
    expect(result).toEqual({ ok: true, id: 'msg_1' })
  })

  it('accepts any matching signature among several, and the previous secret during rotation', () => {
    const old = randomBytes(24)
    const header = `v1,${Buffer.alloc(32).toString('base64')} ${sign('msg_2', ts, body, old)}`
    expect(verifyWebhookSignature(body, headers({ 'svix-id': 'msg_2', 'svix-timestamp': String(ts), 'svix-signature': header }), [SECRET, `whsec_${old.toString('base64')}`], now).ok).toBe(true)
  })

  it.each([
    ['a tampered body', (h: Record<string, string>) => h, body.replace('true', 'false')],
    ['a different id', (h: Record<string, string>) => ({ ...h, 'svix-id': 'msg_other' }), body],
    ['a stale timestamp (replay)', (h: Record<string, string>) => ({ ...h, 'svix-timestamp': String(ts - 600), 'svix-signature': sign('msg_1', ts - 600, body) }), body],
    ['a future timestamp', (h: Record<string, string>) => ({ ...h, 'svix-timestamp': String(ts + 600), 'svix-signature': sign('msg_1', ts + 600, body) }), body],
    ['a v2 signature only', (h: Record<string, string>) => ({ ...h, 'svix-signature': h['svix-signature'].replace('v1,', 'v2,') }), body],
    ['missing headers', () => ({}), body],
  ])('rejects %s', (_label, mutate, payload) => {
    const base = { 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_1', ts, body) }
    expect(verifyWebhookSignature(payload, headers(mutate(base) as Record<string, string>), [SECRET], now).ok).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    const result = verifyWebhookSignature(body, headers({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_1', ts, body) }), [undefined, ''], now)
    expect(result).toEqual({ ok: false, reason: 'webhook secret not configured' })
  })
})

const item = (overrides: Partial<EditionItem> = {}): EditionItem => ({
  id: 'a1',
  slug: 'rates',
  title: 'Rates <script>alert(1)</script>',
  author: 'Ada & Co',
  summary: 'Summary with "quotes" and <b>tags</b>',
  sourceExcerpt: 'x',
  imageUrl: 'https://www.theconsilium.co.uk/cover.png',
  imageAlt: 'Cover',
  url: 'https://www.theconsilium.co.uk/articles/rates',
  category: 'Macro',
  publishedAt: '2026-10-23T09:00:00.000Z',
  ...overrides,
})

describe('newsletter markup', () => {
  const input = { kind: 'WEEKLY' as const, subject: 'The Weekly Edition', previewText: 'Plus 1 more', intro: 'Hello <img src=x onerror=alert(1)>\n\nSecond paragraph', heading: 'Friday 23 October 2026', items: [item(), item({ id: 'a2', imageUrl: null, summary: null, url: 'https://www.theconsilium.co.uk/articles/two', title: 'Two' })] }

  it('escapes every piece of article and editor text', () => {
    const html = renderNewsletterHtml(input)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('Rates &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Ada &amp; Co')
    expect(html).toContain('&lt;b&gt;tags&lt;/b&gt;')
  })

  it('carries Resend’s per-recipient unsubscribe link and the preference and privacy links', () => {
    const html = renderNewsletterHtml(input)
    expect(html).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`)
    expect(html).toMatch(/\/newsletter\/manage"/)
    expect(html).toMatch(/\/privacy"/)
    expect(renderNewsletterText(input)).toContain(UNSUBSCRIBE_PLACEHOLDER)
  })

  it('links only to the snapshot’s canonical article URLs, omits missing images and summaries', () => {
    const html = renderNewsletterHtml(input)
    const articleLinks = [...html.matchAll(/href="([^"]+\/articles\/[^"]+)"/g)].map((m) => m[1])
    expect(new Set(articleLinks)).toEqual(new Set(['https://www.theconsilium.co.uk/articles/rates', 'https://www.theconsilium.co.uk/articles/two']))
    expect((html.match(/<img /g) ?? []).length).toBe(1)
    const text = renderNewsletterText(input)
    expect(text).toContain('Read: https://www.theconsilium.co.uk/articles/two')
  })

  it('lets the editor preview substitute a dead unsubscribe link', () => {
    expect(renderNewsletterHtml(input, { unsubscribeUrl: '#preview' })).not.toContain(UNSUBSCRIBE_PLACEHOLDER)
  })
})

describe('memory provider recipient model', () => {
  it('a broadcast reaches only subscribed segment contacts opted in to its topic', async () => {
    const provider = createMemoryProvider()
    await provider.syncContact({ email: 'weekly@x.co', subscribed: true, topics: { weekly: true, alerts: false } })
    await provider.syncContact({ email: 'both@x.co', subscribed: true, topics: { weekly: true, alerts: true } })
    await provider.syncContact({ email: 'gone@x.co', subscribed: true, topics: { weekly: true, alerts: true } })
    await provider.syncContact({ email: 'gone@x.co', subscribed: false, topics: { weekly: false, alerts: false } })
    const weekly = await provider.createBroadcast({ name: 'w', subject: 's', html: 'h', text: 't', topic: 'weekly' })
    const alerts = await provider.createBroadcast({ name: 'a', subject: 's', html: 'h', text: 't', topic: 'alerts' })
    expect(provider.recipientsOf(weekly.id)).toEqual(['both@x.co', 'weekly@x.co'])
    expect(provider.recipientsOf(alerts.id)).toEqual(['both@x.co'])
    await provider.sendBroadcast(weekly.id)
    await expect(provider.sendBroadcast(weekly.id)).rejects.toThrow(/already sent/)
  })
})
