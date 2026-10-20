# EconSoc Trading Challenge page: maintainer guide

The public page is `/trading-challenge`. Everything it states comes from one file:
**`src/lib/tradingChallenge.ts`**. No database, admin screen or environment variable
is involved; a change is a normal reviewed code change and deploy.

Registration itself is **not** handled by this website. It stays with EconSoc's
existing Google Form → Google Sheet → Apps Script → email automation. The page only
explains it and embeds the form.

## Never put these in the repository

- The MarketWatch game password (it reaches verified members only by email).
- Links to the registration Google Sheet, the Apps Script project, or any
  membership export.
- Any participant data (names, student numbers, emails, usernames) other than
  winners the committee has officially announced.

`tests/unit/trading-challenge.test.ts` fails if the config gains a password,
spreadsheet, Apps Script, token or secret value.

## How the page decides its state

The phase is computed on the server from the **Europe/London calendar date**:

| London date | Phase | What visitors see |
|---|---|---|
| before 28 Oct 2026 | `upcoming` | "Registration open · Trading opens Wednesday 28 October", countdown to the opening bell |
| 28 Oct 2026 – 25 Mar 2027 | `live` | "In progress · Late entries welcome until 25 March", late-entry note in registration |
| from 26 Mar 2027 | `closed` | Registration closed; "Results are being verified" until winners are published |

The page is static and re-rendered at most hourly (`revalidate = 3600`), so a phase
change shows within an hour of London midnight. MarketWatch publishes no start or end
time for the game, so the page only uses dates.

## Common changes

**Turn on non-student registration** (only once the form exists *and* the committee's
manual verification process is ready):

```ts
member: { responderUrl: 'https://docs.google.com/forms/d/e/<form id>/viewform' },
```

Paste the form's **responder** link (Send → link, then open it and copy the
`docs.google.com/forms/d/e/.../viewform` address; a `forms.gle` short link will not
embed). The page derives the embed URL and refuses anything that is not a Google Forms
responder link. The "opening soon" panel is replaced by the embedded form and an
"Open in Google Forms" link automatically.

**Confirm short selling / margin trading.** These are marked `status: 'tbc'` and shown as
"To be confirmed". When the organisers have decided (and MarketWatch is configured to
match), set the value and `status: 'confirmed'`.

**Confirm the tie-break rule.** Set `pendingDecisions.tieBreak` to `false` and replace
the "Ties" rule text in `src/components/trading/ChallengeRules.tsx` with the agreed rule.

**Publish verified winners** (only after the committee has verified eligibility and
announced them):

```ts
results: {
  published: true,
  winners: [
    { place: 1, displayName: 'MarketWatch name' },
    { place: 2, displayName: '…' },
    { place: 3, displayName: '…', finalReturnPct: 12.3 }, // optional, only if verified
  ],
},
```

Nothing about winners renders while `published` is `false`.

## Privacy and security notes

- The Google Form is **not** loaded with the page. It loads when a visitor clicks
  "Enter the Challenge", chooses a route, presses "Load the form here", or (only if they
  have accepted cookies on this site) scrolls near the registration section. The page
  tells visitors the form is hosted by Google and that loading it lets Google set its
  own cookies. The "Open in Google Forms" link always works, including without
  JavaScript.
- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups`):
  the form cannot navigate The Consilium.
- The Content Security Policy allows frames only from `'self'` and
  `https://docs.google.com` (`frame-src`). `frame-ancestors 'none'` and
  `X-Frame-Options: SAMEORIGIN` are unchanged, so no other site can embed The Consilium.
  `tests/unit/csp-frame-policy.test.ts` guards this.
- The page never claims a registration succeeded; the Google Form's own confirmation
  message is the record.

## Rankings

MarketWatch hosts the live rankings; they are visible to signed-in game participants
(logged-out visitors are redirected to the game overview). The page links there and
does not mirror the leaderboard. No public MarketWatch rankings API was found;
scraping the authenticated rankings page is out of scope. The committee's existing
`auditLeaderboard()` Apps Script remains the way to check rankings against approved
registrations before announcing winners.
