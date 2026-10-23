# Newsletter subscriptions, preferences and weekly distribution: implementation plan

Branch `feat/newsletter-system` (from `origin/main` b4b69b3). Nothing here is merged, deployed, migrated
or sent. Production activation is a separate, owner-approved checklist (see ROLLOUT.md).

## What exists today (inspected 2026-10-23)

| Area | Current state | Problem |
|---|---|---|
| `POST /api/subscribe` | Inserts `subscribers(email)` straight away; 201 "Subscribed" vs 200 "Already subscribed" | No double opt-in, no consent proof, reveals whether an address is on the list |
| `/unsubscribe` | GET with `?email&token=HMAC(NEXTAUTH_SECRET or a hard-coded fallback)` **deletes** the row | Link scanners unsubscribe people; no record of withdrawal; deterministic non-expiring token; insecure fallback secret |
| `subscribers` | `id, email, subscribedAt` + identity unique index (`consilium_subscriber_identity`) | No status, consent, preferences or provider references |
| Mail | `src/lib/email.ts` `sendEmail` (Resend, capture/capture-db test transports) | Transactional only; no marketing path, no newsletter sending at all |
| Dashboards | `/editorial/growth/subscribers` (ADMIN, GROWTH), `/admin/subscribers` (ADMIN, EDITOR) | Show every row as "Active" |
| Scheduler | Supabase Cron → `/api/publish-scheduled` (PUBLISH_CRON_SECRET); GitHub workflows manual-only fallback | Must not be weakened |

## Design decisions

1. **One subscriber table, extended additively.** New columns on `subscribers`; new tables only for things
   that must outlive or sit beside a subscriber row: hashed tokens, consent events (proof survives erasure),
   suppressions (keyed by email hash so opt-outs survive erasure), campaigns, webhook events. Campaign audit
   reuses `audit_logs`; the pause switch reuses `site_settings`.
2. **Historical rows become `LEGACY`**: kept, never mailed, never opted in to anything new (alerts = false).
   They become `ACTIVE` only by confirming through the new double opt-in (submitting the form again).
3. **Double opt-in via POST, never GET.** Email links open a page with a button; the button POSTs. Mail
   scanners that prefetch links cannot confirm or unsubscribe anyone. Tokens: 32 random bytes, stored as
   SHA-256, single use (atomic `UPDATE … WHERE usedAt IS NULL AND expiresAt > now()`), confirm = 48 h.
   Manage (preferences) links: 14 days, multi-use; once unsubscribed they only offer a fresh double opt-in.
4. **Enumeration-resistant**: every syntactically valid address gets the same 202 response and timing class;
   whether a mail is actually sent (new, pending, legacy, unsubscribed-but-reconsenting) or not (active,
   suppressed for complaint/bounce, rate-capped) is invisible. Abuse limits: per-IP (memory), per-address
   (DB: max 3 confirmation mails / 24 h, 1 / 24 h for a previously unsubscribed address), global
   (DB: max 60 confirmation mails / hour), honeypot field.
5. **Transactional vs marketing separation.** Confirmation and manage-link mails are requested, one-to-one
   messages and go through the existing `sendEmail` (unchanged). Newsletter delivery goes only through
   `src/lib/newsletter/provider.ts`, which uses a **separate** key `RESEND_MARKETING_API_KEY` (no fallback to
   `RESEND_API_KEY`) and a separate sender. Password resets, publishing notices etc. are untouched.
6. **Resend Contacts + Topics + Broadcasts.** One segment (`RESEND_NEWSLETTER_SEGMENT_ID`) holds confirmed
   contacts; topics `weekly` and `alerts`, both created with `defaultSubscription: opt_out`, so a contact
   receives a topic only after an explicit opt-in pushed from our database. The database is the source of
   truth; Resend is a synced copy. Broadcasts use `{{{RESEND_UNSUBSCRIBE_URL}}}` (Resend adds
   List-Unsubscribe headers); changes made on Resend's page come back through webhooks.
7. **Never the wrong recipients**: before every send (a) every withdrawal (unsubscribe, topic off,
   suppression) must be synced to Resend or the send is held; (b) the segment is listed and any subscribed
   contact that is not an ACTIVE confirmed row in our DB is unsubscribed in Resend first; any failure holds
   the send. Delivery is refused unless `NEWSLETTER_DELIVERY=resend`, `VERCEL_ENV=production` (or the explicit
   `NEWSLETTER_ALLOW_NON_PRODUCTION_SEND=1` for a dedicated staging account), the canonical site URL is
   https, and testing/capture flags are absent. Tests use an in-memory provider; `capture` writes JSONL.
8. **Campaign state machine (DB-enforced dedupe)**: `editionKey` UNIQUE (`weekly:2026-10-23`,
   `alert:<articleId>`). States DRAFT → SCHEDULED → SENDING → SENT, plus BLOCKED (fail-closed check),
   FAILED (retry with backoff, max 4), CANCELLED, SKIPPED (nothing eligible). Claiming a send is one
   atomic UPDATE with a lease, so two concurrent ticks cannot both send. Resend side: the broadcast is
   created as a draft named `consilium:<campaignId>` (recoverable by name after a crash), its id stored,
   and `send` is only called while Resend reports it as `draft`.
9. **Weekly edition**: Friday 18:00 Europe/London (DST-safe via Intl; edition key = London date). Window =
   (previous sent edition's cut-off or 7 days, cut-off], cut-off = send time − 60 min safe delay. Eligible =
   the site's own `publishedArticleWhere` + `publishedAt` in window + `publishedAt <= now − delay` + a
   buildable canonical link + not already in a sent weekly edition. Content = title, author, approved summary
   (the article's published excerpt, locked: editors add an introduction instead), https cover
   image, canonical `https://www.theconsilium.co.uk/articles/<slug>` link. The tick auto-builds a DRAFT at
   cut-off; it is sent only once approved (or if an admin enabled auto-send). Re-check at send: every article
   must still be public with the same slug/title/summary, else BLOCKED for re-approval.
10. **Special alerts**: separate opt-in topic; one alert per article ever (unique key); caps: ≤1 per 7 days,
    ≤3 per 30 days, none within 12 h of a weekly send, article published ≤72 h ago. Admin approval required.
11. **Webhooks**: Svix signature verified with `RESEND_WEBHOOK_SECRET` (constant time, 5-min tolerance,
    multiple signatures/rotation), stored by `svix-id` (idempotent), processed; failure → 500 so Resend
    retries, and the tick re-processes FAILED events. Hard bounce / complaint / provider suppression →
    SUPPRESSED + suppression record. Resend-side unsubscribe → UNSUBSCRIBED. A Resend-side "resubscribe"
    is never accepted (re-subscription only by double opt-in); our state is pushed back.
12. **Triggering**: `POST /api/cron/newsletter` (CRON_SECRET or a dedicated NEWSLETTER_CRON_SECRET), idempotent,
    meant to run hourly. Activation SQL for a Supabase Cron job is provided in `supabase/manual/` and a
    manual-only GitHub workflow as fallback. Nothing is scheduled by merging. The pause switch defaults to
    **paused** when unset (fail closed).
13. **Permissions**: view/preview, build/edit/cancel, prepare alerts, pause = ADMIN, EDITOR, GROWTH;
    approve/schedule/unpause/auto-send = ADMIN only. Every route re-checks server-side.
14. **Database security**: new tables RLS on, no anon/authenticated grants, no new functions; migration has
    no BEGIN/COMMIT (applied with a guarded script), is idempotent and self-checking, like 20261017120000.

## Work items

1. Migration `20261023120000_newsletter_subscriptions.sql` + Prisma models + migration test.
2. `src/lib/newsletter/*`: identity, tokens, config/guards, provider (Resend, capture, memory), subscriptions,
   sync/reconcile, edition (window, eligibility, render), campaigns (state machine, caps, send), webhooks, settings.
3. Routes: subscribe (rewrite), confirm, preferences, unsubscribe, manage-link, webhook, cron tick,
   editorial campaigns/settings/alerts APIs.
4. UI: signup (alerts opt-in checkbox, honeypot, honest copy), confirm page, preference centre, safe
   `/unsubscribe`, editorial Newsletter pages (list, preview, approve/schedule/cancel, audit), dashboards show status.
5. Privacy policy update. Docs: env config, rollout checklist, Resend setup.
6. Tests: unit, DB integration (isolated launcher), Playwright spec. Capture only.

## Second round (review feedback, 2026-10-23)

- No contact cap: complete pagination; rolling, budgeted topic audit (`resendVerifiedAt`); sends wait, never fail,
  until the whole segment is proven correct. Tested with 1,300 rows against a faithful Resend fake.
- Exactly-once hardened: set-once broadcast id, `sendRequestedAt`, settle window, fencing, request timeouts.
- Growth may prepare; only admins approve/resume/auto-send.
- Article content locked; intro + contents list + phone styles in the email.
- `apply.sql` resume mode; migration tested interrupted after every statement.
