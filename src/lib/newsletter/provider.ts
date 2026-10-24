/**
 * The only code that talks to a marketing-mail provider. Three implementations:
 *   - Resend (production): Contacts + Topics + Segments + Broadcasts, with RESEND_MARKETING_API_KEY only;
 *   - capture: appends what would have happened to a local JSONL file (isolated E2E runs);
 *   - memory: in-process fake with failure injection (unit and integration tests).
 * Nothing in this module can send a single email to an individual address: only broadcasts to the
 * configured segment, filtered by topic.
 */
import { resolveDelivery, type ResendMarketingConfig } from './config'

export type Topic = 'weekly' | 'alerts'

export interface ContactState {
  email: string
  /** false = the contact must receive nothing at all (global unsubscribe in Resend). */
  subscribed: boolean
  topics: Record<Topic, boolean>
  contactId?: string | null
}

export interface ProviderContact {
  id: string
  email: string
  unsubscribed: boolean
}

export type BroadcastStatus = 'draft' | 'queued' | 'sent'

export interface BroadcastInput {
  name: string
  subject: string
  previewText?: string
  html: string
  text: string
  topic: Topic
}

export interface MarketingProvider {
  readonly name: 'resend' | 'capture' | 'memory'
  /** Creates or updates the contact so Resend matches `state`. Returns the contact id (null if none exists). */
  syncContact(state: ContactState): Promise<{ contactId: string | null }>
  /** Topic subscriptions as Resend currently has them (null = unknown). */
  getContactTopics(ref: { contactId?: string | null; email: string }): Promise<Record<Topic, boolean | null>>
  /** Every contact in the newsletter segment. */
  listSegmentContacts(): Promise<ProviderContact[]>
  findBroadcastByName(name: string): Promise<{ id: string; status: BroadcastStatus } | null>
  createBroadcast(input: BroadcastInput): Promise<{ id: string }>
  getBroadcast(id: string): Promise<{ id: string; status: BroadcastStatus }>
  sendBroadcast(id: string): Promise<void>
}

/** `retryable` = worth trying again later; `uncertain` = the request may have taken effect. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly uncertain = false,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// ── Resend ──────────────────────────────────────────────────────────────────

type ResendError = { message?: string; name?: string; statusCode?: number | null } | null
type ResendResult<T> = { data: T | null; error: ResendError }

const MIN_INTERVAL_MS = 550 // Resend's default limit is 2 requests per second per team.
const MAX_RATE_LIMIT_RETRIES = 4
const REQUEST_TIMEOUT_MS = 30_000
const PAGE_SIZE = 100
/** Hard stop for runaway pagination (10 million contacts); a real list ends long before. */
const MAX_PAGES = 100_000

function classify(error: NonNullable<ResendError>, uncertainOnServerError = false): ProviderError {
  const status = error.statusCode ?? undefined
  const message = `${error.name ?? 'resend_error'}: ${error.message ?? 'unknown error'}`.slice(0, 500)
  const retryable = status === undefined || status === 429 || status >= 500
  return new ProviderError(message, retryable, status, uncertainOnServerError && retryable)
}

function isNotFound(error: ResendError): boolean {
  return Boolean(error && (error.statusCode === 404 || error.name === 'not_found'))
}

function isAlreadyExists(error: ResendError): boolean {
  return Boolean(error && (error.statusCode === 409 || /already exist/i.test(error.message ?? '')))
}

/** The subset of the Resend SDK this module uses; tests inject a faithful fake (tests/helpers/fakeResend.ts). */
export type ResendClient = Pick<import('resend').Resend, 'contacts' | 'broadcasts'>

export interface ResendProviderOptions {
  client?: ResendClient
  /** Minimum gap between requests (rate limit). Tests use 0. */
  minIntervalMs?: number
  /** A request that has not answered by then is abandoned and reported as an UNCERTAIN outcome. */
  requestTimeoutMs?: number
  /** Backoff unit for 429 retries. */
  retryBaseMs?: number
}

class ResendMarketingProvider implements MarketingProvider {
  readonly name = 'resend' as const
  private lastCall = 0
  private clientPromise: Promise<ResendClient> | null = null
  private readonly minInterval: number
  private readonly timeout: number
  private readonly retryBase: number

  constructor(
    private readonly config: ResendMarketingConfig,
    options: ResendProviderOptions = {},
  ) {
    if (options.client) this.clientPromise = Promise.resolve(options.client)
    this.minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS
    this.timeout = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.retryBase = options.retryBaseMs ?? 1000
  }

  private client() {
    this.clientPromise ??= import('resend').then(({ Resend }) => new Resend(this.config.apiKey))
    return this.clientPromise
  }

  /**
   * Serialises calls under the rate limit, retries 429s with backoff, and bounds every request: a request
   * that throws or does not answer within the timeout may still have reached Resend, so it is reported as
   * `uncertain` and callers that mutate state must reconcile before acting again.
   */
  private async call<T>(fn: (resend: ResendClient) => Promise<ResendResult<T>>): Promise<ResendResult<T>> {
    const resend = await this.client()
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCall + this.minInterval - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      this.lastCall = Date.now()
      let result: ResendResult<T>
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        result = await Promise.race([
          fn(resend),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`no answer within ${this.timeout} ms`)), this.timeout)
          }),
        ])
      } catch (error) {
        throw new ProviderError(`network: ${(error as Error).message}`.slice(0, 500), true, undefined, true)
      } finally {
        if (timer) clearTimeout(timer)
      }
      if (result.error?.statusCode === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, this.retryBase * 2 ** attempt))
        continue
      }
      return result
    }
  }

  private topicsPayload(state: ContactState) {
    const subscription = (on: boolean) => (on && state.subscribed ? ('opt_in' as const) : ('opt_out' as const))
    return [
      { id: this.config.weeklyTopicId, subscription: subscription(state.topics.weekly) },
      { id: this.config.alertsTopicId, subscription: subscription(state.topics.alerts) },
    ]
  }

  async syncContact(state: ContactState): Promise<{ contactId: string | null }> {
    const topics = this.topicsPayload(state)
    if (!state.subscribed) {
      // Withdrawal: global unsubscribe plus both topics off. A contact that does not exist is already "off".
      const ref = state.contactId ? { id: state.contactId } : { email: state.email }
      const updated = await this.call((r) => r.contacts.update({ ...ref, unsubscribed: true }))
      if (isNotFound(updated.error)) return { contactId: null }
      if (updated.error) throw classify(updated.error)
      const topicResult = await this.call((r) => r.contacts.topics.update({ ...ref, topics }))
      if (topicResult.error && !isNotFound(topicResult.error)) throw classify(topicResult.error)
      return { contactId: updated.data?.id ?? state.contactId ?? null }
    }

    if (!state.contactId) {
      const created = await this.call((r) =>
        r.contacts.create({
          email: state.email,
          unsubscribed: false,
          segments: [{ id: this.config.segmentId }],
          topics,
        }),
      )
      if (!created.error && created.data?.id) return { contactId: created.data.id }
      if (created.error && !isAlreadyExists(created.error)) throw classify(created.error)
    }
    // Existing contact: re-enable, make sure it is in the segment, set both topics explicitly.
    const ref = state.contactId ? { id: state.contactId } : { email: state.email }
    const updated = await this.call((r) => r.contacts.update({ ...ref, unsubscribed: false }))
    if (updated.error) throw classify(updated.error)
    const contactId = updated.data?.id ?? state.contactId ?? null
    const segment = await this.call((r) =>
      r.contacts.segments.add(contactId ? { contactId, segmentId: this.config.segmentId } : { email: state.email, segmentId: this.config.segmentId }),
    )
    if (segment.error && !isAlreadyExists(segment.error)) throw classify(segment.error)
    const topicResult = await this.call((r) => r.contacts.topics.update({ ...ref, topics }))
    if (topicResult.error) throw classify(topicResult.error)
    return { contactId }
  }

  async getContactTopics(ref: { contactId?: string | null; email: string }): Promise<Record<Topic, boolean | null>> {
    const query = ref.contactId ? { id: ref.contactId } : { email: ref.email }
    const found = new Map<string, boolean>()
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.call((r) => r.contacts.topics.list({ ...query, limit: PAGE_SIZE, ...(after ? { after } : {}) }))
      if (result.error) throw classify(result.error)
      const data = result.data?.data ?? []
      for (const topic of data) found.set(topic.id, topic.subscription === 'opt_in')
      if (!result.data?.has_more || data.length === 0) break
      after = data[data.length - 1].id
    }
    return { weekly: found.get(this.config.weeklyTopicId) ?? null, alerts: found.get(this.config.alertsTopicId) ?? null }
  }

  /** Every contact in the segment, following Resend's cursor pagination to the end (never truncated). */
  async listSegmentContacts(): Promise<ProviderContact[]> {
    const contacts: ProviderContact[] = []
    const seen = new Set<string>()
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.call((r) =>
        r.contacts.list({ segmentId: this.config.segmentId, limit: PAGE_SIZE, ...(after ? { after } : {}) }),
      )
      if (result.error) throw classify(result.error)
      const data = result.data?.data ?? []
      for (const c of data) {
        if (seen.has(c.id)) continue // defensive: a page boundary must never double-count
        seen.add(c.id)
        contacts.push({ id: c.id, email: c.email, unsubscribed: Boolean(c.unsubscribed) })
      }
      if (!result.data?.has_more) return contacts
      if (data.length === 0) throw new ProviderError('segment listing reported more pages but returned none', true)
      after = data[data.length - 1].id
    }
    throw new ProviderError('segment listing did not finish', true)
  }

  async findBroadcastByName(name: string): Promise<{ id: string; status: BroadcastStatus } | null> {
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.call((r) => r.broadcasts.list({ limit: PAGE_SIZE, ...(after ? { after } : {}) }))
      if (result.error) throw classify(result.error)
      const data = result.data?.data ?? []
      const match = data.find((b) => b.name === name)
      if (match) return { id: match.id, status: match.status }
      if (!result.data?.has_more || data.length === 0) return null
      after = data[data.length - 1].id
    }
    throw new ProviderError('broadcast listing did not finish', true)
  }

  async createBroadcast(input: BroadcastInput): Promise<{ id: string }> {
    const result = await this.call((r) =>
      r.broadcasts.create({
        name: input.name,
        segmentId: this.config.segmentId,
        topicId: input.topic === 'weekly' ? this.config.weeklyTopicId : this.config.alertsTopicId,
        from: this.config.from,
        ...(this.config.replyTo ? { replyTo: this.config.replyTo } : {}),
        subject: input.subject,
        ...(input.previewText ? { previewText: input.previewText } : {}),
        html: input.html,
        text: input.text,
        send: false,
      }),
    )
    if (result.error) throw classify(result.error, true)
    if (!result.data?.id) throw new ProviderError('broadcast create returned no id', true, undefined, true)
    return { id: result.data.id }
  }

  async getBroadcast(id: string): Promise<{ id: string; status: BroadcastStatus }> {
    const result = await this.call((r) => r.broadcasts.get(id))
    if (result.error) throw classify(result.error)
    if (!result.data) throw new ProviderError('broadcast not found', false, 404)
    return { id: result.data.id, status: result.data.status }
  }

  async sendBroadcast(id: string): Promise<void> {
    const result = await this.call((r) => r.broadcasts.send(id))
    if (result.error) throw classify(result.error, true)
  }
}

// ── Memory (tests) and capture (isolated E2E) ───────────────────────────────

export interface MemoryProviderState {
  contacts: Map<string, { id: string; email: string; unsubscribed: boolean; inSegment: boolean; topics: Record<Topic, boolean> }>
  broadcasts: Map<string, BroadcastInput & { id: string; status: BroadcastStatus; sentAt?: string; recipients?: string[] }>
  calls: string[]
}

export type FailureHook = (operation: string, detail?: unknown) => ProviderError | void

export interface MemoryProvider extends MarketingProvider {
  readonly state: MemoryProviderState
  /** Return an error from the hook to make that call fail (once per return). */
  failWith(hook: FailureHook | null): void
  /** Who a broadcast reached: subscribed segment contacts opted in to its topic. */
  recipientsOf(id: string): string[]
}

let memoryCounter = 0

export function createMemoryProvider(
  name: 'memory' | 'capture' = 'memory',
  onEvent?: (event: Record<string, unknown>) => Promise<void> | void,
): MemoryProvider {
  const state: MemoryProviderState = { contacts: new Map(), broadcasts: new Map(), calls: [] }
  let hook: FailureHook | null = null
  const check = (operation: string, detail?: unknown) => {
    state.calls.push(operation)
    const failure = hook?.(operation, detail)
    if (failure) throw failure
  }
  const recipientsOf = (id: string) => {
    const b = state.broadcasts.get(id)
    if (!b) return []
    return [...state.contacts.values()].filter((c) => c.inSegment && !c.unsubscribed && c.topics[b.topic]).map((c) => c.email).sort()
  }
  return {
    name,
    state,
    failWith(next) {
      hook = next
    },
    recipientsOf,
    async syncContact(input) {
      check('syncContact', input)
      const key = input.email.toLowerCase()
      const existing = state.contacts.get(key)
      if (!input.subscribed) {
        if (!existing) return { contactId: null }
        existing.unsubscribed = true
        existing.topics = { weekly: false, alerts: false }
        return { contactId: existing.id }
      }
      const contact = existing ?? { id: `contact_${++memoryCounter}`, email: key, unsubscribed: false, inSegment: true, topics: { weekly: false, alerts: false } }
      contact.unsubscribed = false
      contact.inSegment = true
      contact.topics = { ...input.topics }
      state.contacts.set(key, contact)
      return { contactId: contact.id }
    },
    async getContactTopics(ref) {
      check('getContactTopics', ref)
      const contact = state.contacts.get(ref.email.toLowerCase())
      return contact ? { ...contact.topics } : { weekly: null, alerts: null }
    },
    async listSegmentContacts() {
      check('listSegmentContacts')
      return [...state.contacts.values()].filter((c) => c.inSegment).map((c) => ({ id: c.id, email: c.email, unsubscribed: c.unsubscribed }))
    },
    async findBroadcastByName(broadcastName) {
      check('findBroadcastByName', broadcastName)
      const match = [...state.broadcasts.values()].find((b) => b.name === broadcastName)
      return match ? { id: match.id, status: match.status } : null
    },
    async createBroadcast(input) {
      check('createBroadcast', input)
      const id = `broadcast_${++memoryCounter}`
      state.broadcasts.set(id, { ...input, id, status: 'draft' })
      return { id }
    },
    async getBroadcast(id) {
      check('getBroadcast', id)
      const b = state.broadcasts.get(id)
      if (!b) throw new ProviderError('broadcast not found', false, 404)
      return { id, status: b.status }
    },
    async sendBroadcast(id) {
      check('sendBroadcast', id)
      const b = state.broadcasts.get(id)
      if (!b) throw new ProviderError('broadcast not found', false, 404)
      if (b.status !== 'draft') throw new ProviderError('broadcast already sent', false, 422)
      b.status = 'sent'
      b.sentAt = new Date().toISOString()
      b.recipients = recipientsOf(id)
      await onEvent?.({ kind: 'newsletter.broadcast', id, name: b.name, topic: b.topic, subject: b.subject, previewText: b.previewText, html: b.html, text: b.text, recipients: b.recipients, at: b.sentAt })
    },
  }
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Tests: the real Resend code path against an injected client. */
export function createResendMarketingProvider(config: ResendMarketingConfig, options: ResendProviderOptions = {}): MarketingProvider {
  return new ResendMarketingProvider(config, options)
}

let override: MarketingProvider | null = null
let cached: { key: string; provider: MarketingProvider } | null = null

/** Tests only: route every newsletter call to `provider` (null restores normal resolution). */
export function setMarketingProviderForTests(provider: MarketingProvider | null): void {
  override = provider
}

export type ProviderResolution = { provider: MarketingProvider } | { provider: null; reason: string }

/** The provider this process may use, or null with the reason delivery is off. */
export function getMarketingProvider(): ProviderResolution {
  if (override) return { provider: override }
  const delivery = resolveDelivery()
  if (delivery.mode === 'disabled') return { provider: null, reason: delivery.reason }
  const key = delivery.mode === 'resend' ? `resend:${delivery.config.segmentId}` : `capture:${delivery.file}`
  if (cached?.key !== key) {
    if (delivery.mode === 'resend') {
      cached = { key, provider: new ResendMarketingProvider(delivery.config) }
    } else {
      const file = delivery.file
      cached = {
        key,
        provider: createMemoryProvider('capture', async (event) => {
          const { appendFile } = await import('node:fs/promises')
          await appendFile(file, JSON.stringify(event) + '\n')
        }),
      }
    }
  }
  return { provider: cached.provider }
}
