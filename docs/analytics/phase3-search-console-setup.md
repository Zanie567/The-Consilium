# Phase 3: Google Search Console and weekly editorial review

The Consilium's editorial Analytics portal includes a read-only Search Console panel in **Distribution**, and a database-backed weekly editorial review in **Overview**. The latter is available without any Google integration.

## Connect Google Search Console (one-time owner action)

**Do not paste credentials into ChatGPT, Slack, email or a GitHub issue.**

1. Use the Google Cloud Console to create/select a small Google Cloud project for The Consilium and enable **Google Search Console API**.
2. Create a dedicated **service account**, with no Google Cloud project roles required beyond normal service-account creation. Generate a private key for the account and store it securely.
3. Open [Search Console](https://search.google.com/search-console), select the verified **theconsilium.co.uk** property, then go to **Settings → Users and permissions → Add user**. Enter the service account email and grant **Restricted** (read-only) property access. This is a property-user permission, not a Google Cloud IAM editor role.
4. Add the following **server-side, encrypted** Vercel environment variables for the **Production** target (also Preview if preview verification is needed):
   - `GSC_SERVICE_ACCOUNT_EMAIL`: the service-account email.
   - `GSC_SERVICE_ACCOUNT_PRIVATE_KEY`: the private-key PEM value. Preserve line breaks, or encode line breaks as literal `\\n` (the server converts these). Never expose it as `NEXT_PUBLIC_*`.
   - `GSC_PROPERTY`: exactly the verified Search Console property string, normally `sc-domain:theconsilium.co.uk` for a domain property, or `https://theconsilium.co.uk/` for a URL-prefix property. The integration deliberately rejects other site domains.
5. Redeploy Production to make environment-variable additions effective. Open **Editorial → Analytics → Distribution**. The Google Search card should show figures and dates after Google permissions propagate.

No analytics data is requested before the server sees all three values. **Search Console data is not invented** when a connection is missing or fails. The site has not been configured with any Google credentials by the development PR.

## What the new reports mean

- Google Search Console click/impression/CTR/position data is aggregated Google **web search** reporting, not visitor tracking. It often lags 2–3 days, so the panel deliberately requests only **finalised data ending three days ago**. The portal's 24-hour selector displays the **last seven finalised days** and says so.
- Google sometimes anonymises and drops lower-volume query rows. The sum of rows in the *Top Queries* and *Top Pages* tables **must not be equated** with the property-level summary. The integration issues a separate property-level summary request.
- SEO opportunities are **review candidates**, not guaranteed wins: pages with at least 20 impressions, average position 4–20, and CTR below 5%. Use them to consider stronger search titles and descriptions.
- The weekly editorial review covers **seven complete UTC calendar days ending yesterday**. It records article and public-page view events, tagged first-page campaign arrivals, and newly confirmed subscriptions that are **still active**. It never claims unique people, and it withholds trend percentages while comparison periods include pre-launch activity.
- The editorial priorities are deterministic suggestions derived from the observed data. The summary can be copied but is **not automatically emailed or scheduled**.

## Security and operational controls

- Both analytics API endpoints require the existing editorial analytics role checks.
- Google credentials never reach browser code, Next.js props, API responses or client logs. The requested OAuth 2.0 scope is only `webmasters.readonly`.
- Search Console requests go to fixed Google endpoints using POST and have timeouts. Successful reports are cached **in memory** for two hours per server instance; browser responses remain private/no-store.
- No Prisma migration, no new cookie, no tracking of personal searchers, no new marketing consent assumptions, no extra public SQL permissions and no external scripts.
- Credentials and Google property access can be revoked independently if needed. Failed authentication and missing credentials are displayed as explicit **unavailable/not connected** states, not zeros.
- During rollout, check a restricted/unapproved request gets HTTP 401, the weekly report returns real first-party aggregates and the Search Console panel displays its not-connected state until configured.

Reference documentation: https://developers.google.com/webmaster-tools/v1/searchanalytics/query and https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
