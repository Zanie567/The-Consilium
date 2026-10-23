# Newsletter: staged rollout checklist

Every step needs the owner's explicit go-ahead. Nothing in this branch merges, deploys, migrates, creates
secrets, schedules jobs or sends. Stop at any red result; each step lists its rollback.

## R0. Review (no production contact)

- [ ] Merge order with the launch/security work: #158 (which supersedes #150/#151) and this PR touch no common
      application code; the only textual conflict is the `DB_BACKED_SUITES` list in `vitest.config.ts` (keep both
      entries). Apply #155/#156's production SQL in their own windows; this migration is independent of them.

- [ ] PR reviewed; CI green (lint, typecheck, unit, build, both E2E jobs: the newsletter DB suites run inside them).
- [ ] Owner confirms the copy: signup text, confirmation email, privacy policy section, email footer address.
- [ ] Decide: weekly auto-send stays OFF at launch (recommended), approvals by an admin each Friday.

## R1. Backup and preflight (read-only)

- [ ] Fresh verified backup (`scripts/backup/take-supabase-backup.sh`, then verify) — required before any migration.
- [ ] Supabase Dashboard GitHub integration "Deploy to production" is still OFF (never `supabase db push`).
- [ ] `psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/preflight.sql` — every row matches `expect`; keep the
      subscribers fingerprint.

## R2. Apply the migration (owner-approved window)

- [ ] `psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/apply.sql` → notice
      `newsletter migration verified (first): N subscriber(s) LEGACY, addresses unchanged`.
- If psql/the network/the server stops part-way: it was one transaction, nothing was applied. Re-run R1 preflight and
  the same command.
- If the file was ever run statement-by-statement (e.g. an editor) and stopped part-way: re-run with
  `psql -X -v ON_ERROR_STOP=1 -v resume=1 -f docs/newsletter/production/apply.sql` (verifies the end state; refuses if
  the new code has already been running). Never edit rows by hand to "finish" it.
- [ ] `supabase migration repair --status applied 20261023120000 --linked`
- [ ] `psql -X -v ON_ERROR_STOP=1 -f docs/newsletter/production/verify.sql` — fingerprint identical to R1.
- The currently deployed code keeps working (inserts become PENDING, never mailed; old unsubscribe still deletes).
- Rollback (only before anyone confirms or anything is sent): deploy the previous build first, then
  `supabase/manual/20261023120000_newsletter_subscriptions_rollback.sql`, then
  `supabase migration repair --status reverted 20261023120000 --linked`.

## R3. Deploy the code, delivery still OFF

- [ ] Merge (owner) → production auto-deploys. Do **not** set `NEWSLETTER_DELIVERY` yet.
- [ ] Smoke test on production with a team member's address: homepage sign-up → confirmation mail arrives (transactional
      path) → opening the link changes nothing → button confirms → preferences page → toggle → unsubscribe → re-subscribe
      needs a new confirmation.
- [ ] Password reset, article submitted/returned/published notices, member invite: still delivered (unchanged path).
- [ ] `/editorial/newsletter` shows Delivery "Off" with the reason, Sending "Paused".
- Rollback: revert the merge (schema stays; it is backward compatible).

## R4. Resend configuration (owner, Resend + Vercel dashboards)

- [ ] Follow README "Resend set-up": domain verified, **open/click tracking off**, segment, two opt-out topics, separate
      full-access key, webhook endpoint + signing secret.
- [ ] Resend rate limit: the default is 2 requests/second per team and is shared with transactional mail. Fine for
      ~1,000 subscribers (verification is spread across hourly ticks); above ~5,000, ask Resend for a higher limit.
- [ ] Vercel **Production only** (sensitive where marked): `RESEND_MARKETING_API_KEY`, `RESEND_NEWSLETTER_SEGMENT_ID`,
      `RESEND_TOPIC_WEEKLY_ID`, `RESEND_TOPIC_ALERTS_ID`, `RESEND_WEBHOOK_SECRET`, `NEWSLETTER_CRON_SECRET`,
      `NEWSLETTER_DELIVERY=resend`. Confirm none of them exist in Preview or Development.
- [ ] Redeploy production; `/editorial/newsletter` shows Delivery "Resend". Still paused.
- [ ] Run the tick manually a few times (R5 manual step) and wait until the Newsletter page shows **0 changes not yet
      synced**: the first sync pushes every confirmed subscriber and stamps them verified. With delivery enabled but
      paused, nothing is sent while this happens.
- [ ] Send a Resend test webhook from the dashboard: `/api/webhooks/resend` answers 200; `newsletter_webhook_events` has
      the row (then it is pruned after 30 days).
- Rollback: unset `NEWSLETTER_DELIVERY` and redeploy (sending becomes impossible immediately).

## R5. Scheduler (owner-approved)

- [ ] Vault secret `newsletter_cron_secret` = Vercel `NEWSLETTER_CRON_SECRET` (`openssl rand -hex 32 | tr -d '\n' | pbcopy`).
- [ ] Manual tick first: `gh workflow run newsletter-tick.yml --repo Zanie567/The-Consilium` → HTTP 200.
- [ ] Apply `supabase/manual/newsletter_cron_enable.sql` (SQL editor or psql). Check `cron.job` has `newsletter-tick`
      `7 * * * *`, and after the next :07 a 200 in `net._http_response` and the Vercel log.
- Rollback: `select cron.unschedule('newsletter-tick');`

## R6. First real edition (owner present)

- [ ] Before Friday: confirm the audience on the Newsletter page (only confirmed subscribers count; LEGACY rows are not
      mailed). Optionally email LEGACY addresses a one-off invitation to re-subscribe via the form (transactional,
      owner decision).
- [ ] Friday 17:00 UK: draft appears. Admin previews desktop/mobile/text, checks every article link, approves.
- [ ] Admin presses "Resume sending" (unpause) before 18:00. After the send: status Sent, broadcast id recorded,
      Resend shows one broadcast to the segment/topic, delivery counters rise via webhooks.
- [ ] A team member subscribed through the public form checks the received edition: one email only, links go to
      www.theconsilium.co.uk, the message has `List-Unsubscribe` / `List-Unsubscribe-Post` headers (added by Resend for
      broadcasts), and Resend's unsubscribe page works and comes back as `UNSUBSCRIBED` on the Subscribers page.
- [ ] Pause again if you want manual control between editions.
- Abort at any time: "Pause all sending" (takes effect before claim and again after claim), or cancel the edition.
- If an edition shows **Sending** for more than ~30 minutes or **Failed** with a broadcast id: do NOT create anything in
  Resend by hand. Check the broadcast in the Resend dashboard; the next tick reconciles it automatically (sent →
  recorded as sent; draft after the 15-minute settle window → sent once).

## R7. Afterwards

- [ ] Watch the first three weeks: bounces/complaints on the edition page, suppressed count, webhook failures.
- [ ] Decide on weekly auto-send (admin toggle) once the editorial routine is settled.
- [ ] Special alerts: first use with an admin present; caps are 1 per 7 days, 3 per 30 days, never within 12 h of an edition.
