/**
 * An in-process stand-in for the parts of the Resend SDK the newsletter uses, faithful to the documented
 * behaviour that matters for correctness (https://resend.com/docs):
 *   - contacts are global; `unsubscribed` is a global flag that overrides every topic;
 *   - topics have a default subscription fixed at creation (`opt_out` = excluded unless the contact opts in);
 *   - creating an existing contact fails with 409; updating a missing one with 404;
 *   - lists use cursor pagination (`limit` ≤ 100, `after` = last id, `has_more`);
 *   - a broadcast is created as a draft and can be sent once; sending a non-draft fails;
 *   - a broadcast with a topic reaches segment members that are not unsubscribed and are opted in to it.
 * Fault injection covers what the network can do to us: 429s, errors, timeouts, and responses lost after
 * the request took effect; plus eventually consistent broadcast listing.
 */
type Subscription = 'opt_in' | 'opt_out'
type Result<T> = Promise<{ data: T | null; error: { statusCode: number; name: string; message: string } | null; headers?: null }>

interface FakeContact {
  id: string
  email: string
  unsubscribed: boolean
  segments: Set<string>
  topics: Map<string, Subscription>
  created: number
}

interface FakeBroadcast {
  id: string
  name: string
  segmentId: string
  topicId: string | null
  subject: string
  html: string
  text: string
  from: string
  status: 'draft' | 'queued' | 'sent'
  created: number
  recipients?: string[]
}

export type Fault = { kind: 'error'; status: number; message?: string } | { kind: 'timeout' } | { kind: 'lost-response' } | { kind: 'throw' }

let sequence = 0
const id = (prefix: string) => `${prefix}_${(++sequence).toString(36).padStart(8, '0')}`
const ok = <T>(data: T) => Promise.resolve({ data, error: null, headers: null })
const fail = (statusCode: number, name: string, message: string) => Promise.resolve({ data: null, error: { statusCode, name, message }, headers: null })

export class FakeResend {
  readonly contactsById = new Map<string, FakeContact>()
  readonly broadcastsById = new Map<string, FakeBroadcast>()
  readonly topicDefaults = new Map<string, Subscription>()
  readonly calls: string[] = []
  /** Faults applied to the next call(s) of an operation, in order. */
  private faults = new Map<string, Fault[]>()
  /** Every Nth call (any operation) answers 429 once. 0 = never. */
  rateLimitEvery = 0
  /** Newly created broadcasts stay invisible to `broadcasts.list` for this many list calls. */
  listLagCalls = 0
  private lagUntil = new Map<string, number>()
  private listCalls = 0

  constructor(topics: Record<string, Subscription>) {
    for (const [topicId, def] of Object.entries(topics)) this.topicDefaults.set(topicId, def)
  }

  inject(operation: string, ...faults: Fault[]) {
    this.faults.set(operation, [...(this.faults.get(operation) ?? []), ...faults])
  }

  count(operation: string) {
    return this.calls.filter((c) => c === operation).length
  }

  private byEmail(email: string) {
    const key = email.trim().toLowerCase()
    return [...this.contactsById.values()].find((c) => c.email === key)
  }

  private resolve(ref: { id?: string; contactId?: string; email?: string }) {
    const key = ref.id ?? ref.contactId
    return key ? this.contactsById.get(key) : ref.email ? this.byEmail(ref.email) : undefined
  }

  effective(contact: FakeContact, topicId: string): Subscription {
    return contact.topics.get(topicId) ?? this.topicDefaults.get(topicId) ?? 'opt_out'
  }

  /** Who a broadcast reaches under Resend's rules. */
  audience(segmentId: string, topicId: string | null): string[] {
    return [...this.contactsById.values()]
      .filter((c) => c.segments.has(segmentId) && !c.unsubscribed && (topicId === null || this.effective(c, topicId) === 'opt_in'))
      .map((c) => c.email)
      .sort()
  }

  /**
   * Wraps an operation with fault injection. `apply` performs the state change; a `lost-response` fault
   * applies it and then fails like a dropped connection, `timeout` never answers.
   */
  private async run<T>(operation: string, apply: () => Result<T>): Result<T> {
    this.calls.push(operation)
    if (this.rateLimitEvery > 0 && this.calls.length % this.rateLimitEvery === 0) return fail(429, 'rate_limit_exceeded', 'Too many requests')
    const fault = this.faults.get(operation)?.shift()
    if (!fault) return apply()
    if (fault.kind === 'error') return fail(fault.status, 'injected_error', fault.message ?? 'injected')
    if (fault.kind === 'throw') throw new TypeError('fetch failed')
    if (fault.kind === 'timeout') return new Promise(() => undefined)
    await apply()
    throw new TypeError('socket hang up (response lost after the request was applied)')
  }

  // ── simulations of things recipients do on Resend's side ─────────────────

  /** RFC 8058 one-click or "unsubscribe from all" on Resend's page: global flag. Returns the webhook payload. */
  oneClickUnsubscribe(email: string) {
    const contact = this.byEmail(email)!
    contact.unsubscribed = true
    return this.contactEvent('contact.updated', contact)
  }

  /** A topic toggle on Resend's preference page. Returns the webhook payload. */
  setTopicOnPreferencePage(email: string, topicId: string, subscription: Subscription) {
    const contact = this.byEmail(email)!
    contact.topics.set(topicId, subscription)
    return this.contactEvent('contact.updated', contact)
  }

  contactEvent(type: string, contact: FakeContact) {
    return {
      type,
      created_at: new Date().toISOString(),
      data: { id: contact.id, email: contact.email, unsubscribed: contact.unsubscribed, audience_id: '', segment_ids: [...contact.segments], created_at: new Date(contact.created).toISOString(), updated_at: new Date().toISOString() },
    }
  }

  // ── SDK surface ──────────────────────────────────────────────────────────

  readonly contacts = {
    create: (input: { email: string; unsubscribed?: boolean; segments?: { id: string }[]; topics?: { id: string; subscription: Subscription }[] }) =>
      this.run('contacts.create', () => {
        if (this.byEmail(input.email)) return fail(409, 'validation_error', 'Contact already exists')
        const contact: FakeContact = {
          id: id('contact'),
          email: input.email.trim().toLowerCase(),
          unsubscribed: Boolean(input.unsubscribed),
          segments: new Set((input.segments ?? []).map((s) => s.id)),
          topics: new Map((input.topics ?? []).map((t) => [t.id, t.subscription])),
          created: Date.now() + sequence,
        }
        this.contactsById.set(contact.id, contact)
        return ok({ object: 'contact' as const, id: contact.id })
      }),
    update: (input: { id?: string; email?: string; unsubscribed?: boolean }) =>
      this.run('contacts.update', () => {
        const contact = this.resolve(input)
        if (!contact) return fail(404, 'not_found', 'Contact not found')
        if (input.unsubscribed !== undefined) contact.unsubscribed = input.unsubscribed
        return ok({ object: 'contact' as const, id: contact.id })
      }),
    list: (input: { segmentId?: string; limit?: number; after?: string }) =>
      this.run('contacts.list', () => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
        const all = [...this.contactsById.values()].filter((c) => !input.segmentId || c.segments.has(input.segmentId)).sort((a, b) => a.created - b.created)
        const start = input.after ? all.findIndex((c) => c.id === input.after) + 1 : 0
        const page = all.slice(start, start + limit)
        return ok({
          object: 'list' as const,
          has_more: start + limit < all.length,
          data: page.map((c) => ({ id: c.id, email: c.email, unsubscribed: c.unsubscribed, created_at: new Date(c.created).toISOString(), first_name: null, last_name: null })),
        })
      }),
    segments: {
      add: (input: { contactId?: string; email?: string; segmentId: string }) =>
        this.run('contacts.segments.add', () => {
          const contact = this.resolve(input)
          if (!contact) return fail(404, 'not_found', 'Contact not found')
          contact.segments.add(input.segmentId)
          return ok({ id: input.segmentId })
        }),
    },
    topics: {
      update: (input: { id?: string; email?: string; topics: { id: string; subscription: Subscription }[] }) =>
        this.run('contacts.topics.update', () => {
          const contact = this.resolve(input)
          if (!contact) return fail(404, 'not_found', 'Contact not found')
          for (const t of input.topics) contact.topics.set(t.id, t.subscription)
          return ok({ id: contact.id })
        }),
      list: (input: { id?: string; email?: string; limit?: number; after?: string }) =>
        this.run('contacts.topics.list', () => {
          const contact = this.resolve(input)
          if (!contact) return fail(404, 'not_found', 'Contact not found')
          const all = [...this.topicDefaults.keys()]
          const limit = Math.min(input.limit ?? 20, 100)
          const start = input.after ? all.indexOf(input.after) + 1 : 0
          const page = all.slice(start, start + limit)
          return ok({ object: 'list' as const, has_more: start + limit < all.length, data: page.map((topicId) => ({ id: topicId, name: topicId, description: null, subscription: this.effective(contact, topicId) })) })
        }),
    },
  }

  readonly broadcasts = {
    create: (input: { name?: string; segmentId: string; topicId?: string | null; from: string; subject: string; html?: string; text?: string; send?: boolean }) =>
      this.run('broadcasts.create', () => {
        const broadcast: FakeBroadcast = { id: id('broadcast'), name: input.name ?? '', segmentId: input.segmentId, topicId: input.topicId ?? null, subject: input.subject, html: input.html ?? '', text: input.text ?? '', from: input.from, status: 'draft', created: Date.now() + sequence }
        this.broadcastsById.set(broadcast.id, broadcast)
        this.lagUntil.set(broadcast.id, this.listCalls + this.listLagCalls)
        return ok({ id: broadcast.id })
      }),
    list: (input: { limit?: number; after?: string }) =>
      this.run('broadcasts.list', () => {
        this.listCalls++
        const limit = Math.min(input.limit ?? 20, 100)
        const all = [...this.broadcastsById.values()].filter((b) => (this.lagUntil.get(b.id) ?? 0) < this.listCalls).sort((a, b) => b.created - a.created)
        const start = input.after ? all.findIndex((b) => b.id === input.after) + 1 : 0
        const page = all.slice(start, start + limit)
        return ok({ object: 'list' as const, has_more: start + limit < all.length, data: page.map((b) => ({ id: b.id, name: b.name, audience_id: null, segment_id: b.segmentId, status: b.status, created_at: '', scheduled_at: null, sent_at: null })) })
      }),
    get: (broadcastId: string) =>
      this.run('broadcasts.get', () => {
        const b = this.broadcastsById.get(broadcastId)
        if (!b) return fail(404, 'not_found', 'Broadcast not found')
        return ok({ object: 'broadcast' as const, id: b.id, name: b.name, segment_id: b.segmentId, audience_id: null, from: b.from, subject: b.subject, reply_to: null, preview_text: null, status: b.status, created_at: '', scheduled_at: null, sent_at: null, topic_id: b.topicId, html: b.html, text: b.text })
      }),
    send: (broadcastId: string) =>
      this.run('broadcasts.send', () => {
        const b = this.broadcastsById.get(broadcastId)
        if (!b) return fail(404, 'not_found', 'Broadcast not found')
        if (b.status !== 'draft') return fail(422, 'validation_error', 'Broadcast has already been sent')
        b.status = 'sent'
        b.recipients = this.audience(b.segmentId, b.topicId)
        return ok({ id: b.id })
      }),
  }

  /** Every broadcast that actually went out, with who it reached. */
  sent() {
    return [...this.broadcastsById.values()].filter((b) => b.status !== 'draft')
  }
}
