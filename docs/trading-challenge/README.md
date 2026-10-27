# EconSoc Trading Challenge page: maintainer guide

The public page is `/trading-challenge`. Everything it states comes from one file:
**`src/lib/tradingChallenge.ts`**. No database, admin screen or environment variable
is involved; a change is a normal reviewed code change and deploy.

Registration itself is **not** handled by this website:

- **University of Edinburgh students** use EconSoc's existing Google Form → Google
  Sheet → Apps Script → email automation. The page explains it and embeds the form.
- **Paid non-student members** email the committee (`supportEmail`). The "Contact
  EconSoc to Register" button opens an email with the subject *Trading Challenge –
  Non-Student Registration* and a short template asking for their full name,
  MarketWatch display name and the email address they bought membership with. The
  committee verifies membership by hand and replies with the login details. Nothing
  about this route is automated, and the page says so.

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
| before 10 Nov 2026 | `upcoming` | "Registration open · Trading opens Tuesday 10 November", countdown to the opening bell |
| 10 Nov 2026 – 25 Mar 2027 | `live` | "In progress · Late entries welcome until 25 March", late-entry note in registration |
| from 26 Mar 2027 | `closed` | Registration closed; "Results are being verified" until winners are published |

The page is static and re-rendered at most hourly (`revalidate = 3600`), so a phase
change shows within an hour of London midnight. MarketWatch publishes no start or end
time for the game, so the page only uses dates.

**Known discrepancy (October 2026).** The competition was postponed and moved to a
replacement game, `https://www.marketwatch.com/games/the-econsoc-trading-challenge-26-27`
(the withdrawn game was `…/the-econsoc-trading-challenge-2026-27`; never link it).
The game was created with 10 November 2026 – 25 March 2027, which is what this page
states, but MarketWatch's overview shows **Nov 9, 2026 – Mar 24, 2027**. The cause (a
time-zone display shift or the real trading window) has not been confirmed. Check the
game on 9 and 10 November and again on 24 and 25 March, and change `startDate` /
`endDate` only if MarketWatch's actual window turns out to differ.

The share card (`public/og/trading-challenge-v2.png`) has the trading dates drawn into
it. If the dates change again, regenerate it under a new versioned path with
`node scripts/brand/generate-trading-card.mjs` (see the script header) and update
`SHARE_IMAGE` in `src/app/trading-challenge/page.tsx`.

## Common changes

**Change the non-student email.** Edit `registration.nonStudent` (subject and
template) or `supportEmail`. Keep the template to what the committee needs; never ask
for a password.

**Game settings.** The page states only the essentials ("Competition at a glance":
organiser, platform, dates, starting balance, markets, prizes). Detailed MarketWatch
settings (commission, order types, short selling, margin and so on) are deliberately
not restated: the game is the authority on them, and leaving them off the page does not
change them on MarketWatch. To change a glance item, edit `markets`, the dates, the
balance or the prizes.

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

## Motion

All motion is CSS; no animation library or animation script ships with the page.

- **Hero chart.** The full chart is in the HTML. A clip slides across the plot while
  its contents slide the other way (both compositor transforms), so the trend draws
  itself: the first stretch on load, the rest tied to scroll position through CSS
  scroll-driven animations (`animation-timeline`). A narrow window rides the same edge
  over a glowing copy of the line, so the line's leading point lights up. On wide
  screens the growth spans the first 150 px of scrolling (200 px on screens at least
  860 px tall; `--trading-scroll-end`), so it finishes before the top of the chart
  passes under the navigation bar. On phones and tablets it follows the chart rising
  into view. Browsers without
  scroll-driven animations (currently Firefox) draw the whole chart on load. See
  "Chart reveal" in `src/app/globals.css`.
- **Prize podium.** Columns rise from the floor line in podium order (second, first,
  third), then each medal is presented and a light crosses its face. It plays once,
  when the podium first scrolls into view (`RevealOnScroll`).
- **Elsewhere:** the hero's quote board settles in after the headline, the steps
  arrive in sequence while the line joining them draws, and sections fade up as they
  enter. Switching registration route settles the new panel in.
- **Reduced motion** (`prefers-reduced-motion: reduce`) shows the finished chart and
  podium immediately. With JavaScript disabled everything is visible; only the
  scroll-triggered entrances no longer wait for the reader.

## Privacy and security notes

- The Google Form is **not** loaded with the page. It loads when a visitor clicks
  "Enter the Challenge", chooses the student route, presses "Load the form here", or (only if they
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
