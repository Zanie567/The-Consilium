# Brand assets and social previews

## The assets

| Path | Size | Use |
| --- | --- | --- |
| `/og/consilium-share-v2.png` | 1200×630 PNG | Default `og:image` / `twitter:image` for every page without its own |
| `/brand/consilium-mark-v2.png` | 512×512 PNG | Square logo: structured-data `publisher.logo`, anywhere a mark is needed |
| `/logo.png` | 512×512 PNG | **Legacy address only.** Same bytes as the mark, kept for old links and caches. Never reference it. |
| `/og/trading-challenge-v2.png` | 1200×630 PNG | Campaign card, `/trading-challenge` only (trading dates 9 Nov – 24 Mar; redrawn by `scripts/brand/generate-trading-card.mjs`) |
| `/og/trading-challenge.png` | 1200×630 PNG | **Superseded** campaign card (old dates 28 Oct – 25 Mar). Kept only for caches of earlier shares and as the generator's source. Never reference it. |
| `src/app/favicon.ico`, `src/app/icon1.png`, `src/app/icon2.png`, `src/app/apple-icon.png`, `public/apple-touch-icon.png`, `public/brand/app-icon-*-v1.png` | 16–512 px PNG/ICO | Favicons, iOS home-screen icon and manifest icons: opaque navy squares (`#14213e`) with the emblem centred, no transparency |

`src/lib/brand.ts` is the only place that names these paths. Metadata comes from the helpers in
`src/lib/seo.ts` (`pageOpenGraph`, `pageTwitter`, `articleShareImages`), never from hand-written objects:
Next merges metadata shallowly, so a partial `openGraph` or `twitter` object silently drops the image.

The source of truth for the artwork is the navy-and-gold emblem, `public/brand/consilium-mark-v2.png`. To regenerate:

```sh
node scripts/brand/generate-brand-assets.mjs   # share card + /logo.png; needs network once, for Google Fonts
node scripts/brand/generate-app-icons.mjs      # favicons, apple-icon, manifest icons
```

A new design goes to a new path (`consilium-share-v3.png`) and `brand.ts` is updated. Do not overwrite a
published image in place: platforms cache by URL.

## Guards

- `tests/unit/brand-assets.test.ts` (CI unit job): declared sizes and types match the files; `/logo.png` is
  the current mark; no image in `public/` or `src/app/` is a copy, by SHA-256 or perceptual hash, of the
  obsolete designs (fingerprints in `tests/helpers/legacyBrand.ts`); no `src/` file references `/logo.png`.
- `tests/e2e/wf-share-preview.spec.ts` (CI `wf-chromium`): the served HTML of home, static pages, a
  category, an author, articles with and without a cover, and the trading challenge; each image is
  fetched and decoded.

## Checking a deployment

```sh
curl -sL https://www.theconsilium.co.uk/ | grep -oE '<meta (property|name)="(og|twitter):[^"]*" content="[^"]*"'
curl -sI https://www.theconsilium.co.uk/og/consilium-share-v2.png    # 200, image/png
curl -s https://www.theconsilium.co.uk/logo.png | shasum -a 256      # must NOT be deb417b35b462bc4…
```

The apex `theconsilium.co.uk` (the `SITE_URL` in metadata, canonicals and RSS) answers with a temporary 307
redirect to `www`. The X, Facebook and LinkedIn crawlers follow it (checked October 2026), but choosing one
canonical host is a separate, site-wide decision that this change deliberately leaves alone.

## Refreshing third-party previews

Each platform caches a URL's card independently of our deployment. Nothing on our side can purge those caches.
The durations below are approximate and set by each platform; none is guaranteed.

- **Facebook / Instagram / WhatsApp / Threads:** <https://developers.facebook.com/tools/debug/>. Enter the URL and press
  **Scrape Again**. This refreshes Meta's cache for that URL. WhatsApp may keep a thumbnail on devices that already rendered it.
- **LinkedIn:** <https://www.linkedin.com/post-inspector/>. Inspecting a URL re-fetches it. LinkedIn's cache otherwise
  lasts about 7 days.
- **X / Twitter:** X no longer offers a card validator. Paste the link into a new post draft: the preview is
  fetched when X's cache for that URL expires (typically up to about 7 days). To see the new card at once, share
  the URL with a harmless query string (e.g. `https://theconsilium.co.uk/?v=2`), which X treats as a new URL.
  **Posts already published keep the card image X stored when they were posted.**
- **Slack / Discord / iMessage:** each caches per URL. Slack refreshes after about 30 minutes, or immediately for a URL with a new query string.

## Not covered by this repository

Uploaded media lives in Supabase Storage (`article-images`, `avatars`) and image URLs live in the database
(`users.image`, `team_members.image`, `articles.coverImage`, article bodies). A record that points at `/logo.png`
now shows the current mark. A copy of the old artwork **uploaded** to storage would not be caught by these tests.
To audit, list both buckets with the service key and run `legacyMatch()` from `tests/helpers/legacyBrand.ts` over
each object. Read-only, owner-approved.
