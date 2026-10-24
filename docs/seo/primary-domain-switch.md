# Make https://theconsilium.co.uk the primary domain (www → apex, 308)

Owner-run. **Nothing here has been changed in production.** Every step needs the owner's go-ahead.

## Why

Canonical tags, `og:url`, JSON-LD, the sitemap, robots.txt, RSS and share links all use
`https://theconsilium.co.uk`, from production's `NEXT_PUBLIC_SITE_URL` and the code's fallbacks. But Vercel serves
`www.theconsilium.co.uk` and answers the apex with a **307 (temporary)** redirect to `www`. Google is therefore
told "canonical = apex" while the apex temporarily redirects to `www`. Making the apex primary (`www` → apex with
**308**) makes every signal agree without changing any URL Google has already indexed.

## Findings (read-only, 2026-10-24/25)

| Item | Today | Impact of the switch |
|---|---|---|
| Vercel domains (`the-consilium`) | `www` serves; apex → `www` 307; `the-consilium.vercel.app` serves | Swap: apex serves; `www` → apex 308 |
| `NEXT_PUBLIC_SITE_URL` (Production) | apex (as rendered in every canonical) | none |
| `NEXTAUTH_URL` (Production) | **`https://www.theconsilium.co.uk`** (from `/api/auth/providers`) | must become `https://theconsilium.co.uk` |
| Google OAuth redirect URIs | `www` callback in use; **apex callback `https://theconsilium.co.uk/api/auth/callback/google` is already registered** (probe reached Google sign-in; an unregistered control URI got `redirect_uri_mismatch`) | none in Google Cloud |
| Session cookies | NextAuth defaults: host-only `__Secure-next-auth.session-token` on `www` | everyone signed in is signed out **once** and signs in again on the apex |
| Sign-in / OAuth state cookies | host-only | Google sign-in must start and finish on the same host as `NEXTAUTH_URL`; keep the window between steps 3 and 6 short |
| Email links (verification, reset, review, "read it live") | built from `NEXTAUTH_URL` (`www`) | new emails use the apex; links already sent keep working through the 308 (path and query kept) |
| **Supabase Cron publisher** (the only automatic publisher) | `invoke_publish_scheduled()` POSTs to `https://www.theconsilium.co.uk/api/publish-scheduled`; last 5 runs 200 | **would stop publishing** once `www` redirects (pg_net is not relied on to follow redirects). Migration `20261025120000` repoints it |
| GitHub cron workflows (award trophies, engagement scores, streaks, scheduler health, purge trash) | hard-coded `www`, curl without `-L` | **would fail** once `www` redirects. This PR points them at the apex |
| GitHub secret `SITE_URL` (manual publish fallback) | value not readable; documented as `www` | set to `https://theconsilium.co.uk` |
| CSRF same-origin check (proxy) | compares `Origin` with `Host` | works on either host |
| EconSoc site (`/api/latest-article`, CORS `*`) | caller's host unknown (Vercel keeps 1 h of logs) | a server-side fetch follows the 308; a **browser** fetch from `www` would fail CORS on the redirect: ask EconSoc to use the apex |
| Resend sender `noreply@theconsilium.co.uk`, Supabase Storage URLs, DNS records | unrelated to the Vercel redirect | none |
| Search Console | sitemap `https://theconsilium.co.uk/sitemap.xml` reports Success | none; do not resubmit |

## Order (no outage, no loop)

Never redirect between the hosts in application code: Vercel's domain redirect runs first, and the two would loop.

1. **Vercel → Domains:** edit `theconsilium.co.uk` and remove its redirect, so **both hosts serve** the site.
   Check: `curl -sI https://theconsilium.co.uk/ | head -1` → 200, and the same for `www`.
2. **Supabase (SQL):** apply `supabase/migrations/20261025120000_publish_cron_apex_host.sql` in one transaction,
   then record it: `supabase migration repair --status applied 20261025120000 --linked`. Then wait for the next
   5-minute run and check:
   `SELECT status_code, outcome FROM public.scheduler_invocations ORDER BY invoked_at DESC LIMIT 3;` → `200 / success`.
3. **Vercel → Environment variables (Production):** set `NEXTAUTH_URL` = `https://theconsilium.co.uk`.
4. **Merge this PR.** That deploys with the new `NEXTAUTH_URL` and points the GitHub workflows at the apex.
   Sign in on the apex with Google and with a password.
5. **GitHub → Settings → Secrets → Actions:** set `SITE_URL` = `https://theconsilium.co.uk`.
6. **Vercel → Domains:** set `www.theconsilium.co.uk` to redirect to `theconsilium.co.uk` with **308**.
7. **Verify:**
   ```sh
   curl -sI https://www.theconsilium.co.uk/articles/sanctions-sundaresan | grep -iE '^(HTTP|location)'   # 308 -> https://theconsilium.co.uk/articles/sanctions-sundaresan
   curl -sI https://theconsilium.co.uk/articles/sanctions-sundaresan | head -1                          # 200
   curl -s https://theconsilium.co.uk/api/auth/providers                                                # callbackUrl on the apex
   curl -s https://theconsilium.co.uk/sitemap.xml | grep -c 'www\.'                                     # 0
   ```
   Then: Google sign-in, password sign-in, password-reset email link, a newsletter sign-up, and one manual run of each
   GitHub cron workflow (all 200). The next scheduled publication goes out on time.
8. Tell EconSoc to call `https://theconsilium.co.uk/api/latest-article`.

## Rollback

* Steps 6/1: in Vercel, remove the `www` redirect and restore apex → `www`.
* Step 3: set `NEXTAUTH_URL` back to `https://www.theconsilium.co.uk` and redeploy.
* Step 2: `supabase/manual/20261025120000_publish_cron_apex_host_rollback.sql`.
* Step 4: revert this PR (the workflows return to `www`).

Undo them in the reverse order (6 → 1). The site keeps working at every point as long as each host a machine
caller uses answers directly.
