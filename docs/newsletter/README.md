# Newsletter: how it works and how to configure it

The Weekly Edition goes out on Fridays at 18:00 UK time with the articles published that week (at least an
hour before the send). Readers can also opt in to occasional special-article alerts. Everything is
double opt-in, fail-closed and audited. Plan: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). Rollout:
[ROLLOUT.md](ROLLOUT.md).

## Moving parts

| Piece | Where |
|---|---|
| Sign-up (double opt-in request) | `POST /api/subscribe`, homepage `NewsletterSignup` |
| Confirm (button POST, never on page load) | `/newsletter/confirm` → `POST /api/newsletter/confirm` |
| Preference centre (topics, unsubscribe, re-subscribe) | `/newsletter/preferences?token=…`, `POST /api/newsletter/{preferences,unsubscribe,reconfirm}` |
| Ask for a preferences link | `/newsletter/manage` → `POST /api/newsletter/manage-link` |
| Old unsubscribe links (HMAC) | `/unsubscribe` shows a button; `POST /api/newsletter/unsubscribe` |
| Resend webhooks (Svix-signed) | `POST /api/webhooks/resend` |
| Scheduler tick (hourly once activated) | `POST /api/cron/newsletter` |
| Editorial UI | `/editorial/newsletter`, `/editorial/newsletter/[id]` |
| Library | `src/lib/newsletter/*` (one module per concern; `campaigns.ts` documents the state machine) |
| Schema | `supabase/migrations/20261023120000_newsletter_subscriptions.sql` (+ Prisma models) |

Transactional mail (password resets, publishing notices, member invites, the confirmation and preference-link
mails) still goes through `src/lib/email.ts` with `RESEND_API_KEY`, unchanged. Newsletter broadcasts go only
through `src/lib/newsletter/provider.ts` with `RESEND_MARKETING_API_KEY`.

## Who can do what

| Action | Roles |
|---|---|
| View editions, previews, audit trail, delivery status | ADMIN, EDITOR, GROWTH |
| Build/rebuild/edit/cancel editions; prepare special alerts for approval | ADMIN, EDITOR, GROWTH |
| Pause all sending | ADMIN, EDITOR, GROWTH |
| Approve (= schedule) a send; resume sending; turn on weekly auto-send | **ADMIN only** |

Approval is bound to the exact content hash the approver previewed; any later edit returns the edition to draft.

**What editors can change in an edition:** subject, inbox preview text, an introduction ("From the editors",
plain text, paragraphs), and which articles are included. Article titles, authors, summaries (the published
excerpt), images and links are locked to the published article; the send-time check compares them again.
The email has an "In this edition" contents list and phone styles; the editorial preview shows desktop,
mobile and plain text.

## Environment variables

All newsletter delivery is **off** unless every one of these is set on the **Production** environment. Unset means
off, never "whatever another environment has".

| Variable | Environments | Value |
|---|---|---|
| `NEWSLETTER_DELIVERY` | Production only | `resend` (anything else, or unset, disables broadcasts) |
| `RESEND_MARKETING_API_KEY` | Production only, sensitive | A **separate** Resend key with full access (Contacts/Topics/Broadcasts). Must differ from `RESEND_API_KEY`; no fallback. |
| `RESEND_NEWSLETTER_SEGMENT_ID` | Production only | Segment that holds confirmed contacts (create empty; the app fills it) |
| `RESEND_TOPIC_WEEKLY_ID` | Production only | Topic "The Weekly Edition", **default subscription: opt-out** |
| `RESEND_TOPIC_ALERTS_ID` | Production only | Topic "Special-article alerts", **default subscription: opt-out** |
| `RESEND_WEBHOOK_SECRET` | Production only, sensitive | `whsec_…` signing secret of the webhook endpoint below |
| `RESEND_WEBHOOK_SECRET_PREVIOUS` | optional | Previous secret during a rotation, then remove |
| `NEWSLETTER_FROM` | optional | Default `The Consilium <newsletter@theconsilium.co.uk>`; must be on theconsilium.co.uk |
| `NEWSLETTER_REPLY_TO` | optional | e.g. the editors' address |
| `NEWSLETTER_CRON_SECRET` | Production only, sensitive | ≥ 32 chars, `openssl rand -hex 32 \| tr -d '\n'`; same value as Vault `newsletter_cron_secret`. `CRON_SECRET` is also accepted. |
| `NEWSLETTER_IP_HASH_SECRET` | optional, sensitive | Key for the consent-proof IP hash (falls back to `NEXTAUTH_SECRET`; with neither, no IP hash is stored) |
| `NEXT_PUBLIC_SITE_URL` | Production | Must be `https://www.theconsilium.co.uk` for production sends (enforced) |
| `NEWSLETTER_ALLOW_NON_PRODUCTION_SEND` | never in Production/Preview of this project | `1` only for a dedicated staging deployment with its **own** Resend account |
| `NEWSLETTER_VERIFY_LINKS` | optional | `1` forces the send-time HTTP 200 check of every article link outside production (always on in production) |

Guards in `src/lib/newsletter/config.ts` refuse to send when: any test/testing flag is present (`NODE_ENV=test`,
Vitest, `E2E_ISOLATED`, `TEST_HARNESS`, `TESTING_MODE_ENABLED`, `EMAIL_TRANSPORT=capture*`), `VERCEL_ENV` is not
`production`, the marketing key equals the transactional key or does not look like a Resend key, a segment/topic is
missing or the topics are equal, the sender is off-domain, or links would not point at the canonical https host.
Preview deployments therefore can never broadcast, whatever variables they inherit.

## Resend set-up (owner, in the Resend dashboard)

1. Domain `theconsilium.co.uk` verified (SPF/DKIM; add DMARC if absent). Consider a sending subdomain for
   marketing reputation separation, then set `NEWSLETTER_FROM` accordingly.
2. **Turn open and click tracking OFF** for the sending domain (the privacy policy says we do not track them).
3. Create segment "Newsletter: confirmed" → `RESEND_NEWSLETTER_SEGMENT_ID`.
4. Create topics "The Weekly Edition" and "Special-article alerts", both **default subscription opt-out** → topic ids.
5. Create an API key with full access → `RESEND_MARKETING_API_KEY`. Keep `RESEND_API_KEY` a sending-only key.
6. Webhook endpoint `https://www.theconsilium.co.uk/api/webhooks/resend` with events: `contact.updated`,
   `contact.deleted`, `email.delivered`, `email.bounced`, `email.complained`, `email.suppressed`
   (optionally `email.failed`) → signing secret into `RESEND_WEBHOOK_SECRET`.

## Operations

- **Pause**: Newsletter page → "Pause all sending" (editors and admins). Default when unset is paused.
- **Weekly flow**: the tick builds a draft at Friday 17:00 UK (cut-off); an admin previews and approves; it sends at
  18:00 (or immediately if approved later the same evening). With "approve automatically" on, the tick approves at
  cut-off. An edition more than 24 h late is skipped and its articles roll into the next one.
- **Blocked**: the send-time check found an article no longer public or changed (title, summary source, link,
  publication time) or a link not answering 200. Rebuild, review, approve again.
- **Failed**: Resend refused or was unreachable before anything was sent; automatic retries at +10 min, +30 min,
  +2 h, then it stops and needs an editor. If the outcome was unknown (timeout during send), the campaign stays
  "Sending" until its lease expires and then Resend's own broadcast state decides; it is never sent twice.
- **Audience safety (no size limit)**: before every send, for the whole segment (cursor pagination to the end):
  every pending change is pushed; every contact able to receive mail must be an active confirmed subscriber here
  (others are switched off first); every active subscriber must be present (missing ones are re-pushed); and every
  active subscriber's topics must have been confirmed in Resend within 7 days (by a push, a webhook or the rolling
  audit). Until all of that is true the send **waits** (status stays Scheduled, no attempt used) instead of failing
  or guessing. The hourly tick spends up to ~100 s syncing and auditing, least recently verified first; at Resend's
  default 2 requests/second that re-verifies ~1,000 contacts every few hours. Drift is only ever resolved in the safe
  direction: Resend more permissive → Resend corrected; a withdrawal made in Resend → adopted here with a consent
  record. Nobody is re-opted in by an audit.
- **Exactly once**: the Resend broadcast id is stored the moment it exists (set once); `sendRequestedAt` is stored
  before the send request; any retry first asks Resend for the broadcast's status (anything but draft = recorded as
  sent). After an unanswered send request a "draft" answer is not trusted for 15 minutes. A crash between create and
  save leaves only an unsent draft (found again by its unique name `consilium:<campaignId>`). Every write after the
  claim is fenced to the claiming attempt, so a worker whose lease expired cannot act. Every Resend request times out
  after 30 s and is treated as an unknown outcome.
- **Webhook backlog**: failed webhook events are retried by every tick (max 10 attempts); events are kept 30 days.

## Data and retention

See the privacy policy (`/privacy#newsletter`). Implemented in `src/lib/newsletter/tick.ts` `applyRetention`:
unconfirmed sign-ups 30 days; expired link tokens 7 days after expiry; unsubscribed rows 2 years after unsubscribing;
orphaned consent records 2 years; webhook events 30 days; suppression hashes kept; sent editions kept (no recipient
lists are ever stored here).
