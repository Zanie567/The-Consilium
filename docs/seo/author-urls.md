# Author URLs: today, and how to give every writer a readable one

Assessment only (9 November 2026). Nothing here has been changed in production.

## Today

* `/author/<x>` looks the user up by `slug` first, then by `id` (`src/app/author/[slug]/page.tsx`). Its canonical
  is `/author/<slug>` when the user has a slug, otherwise `/author/<id>`. Article bylines link to the same form.
* In production, all 9 writers with a public article have **no slug**, so their pages live at
  `/author/cm…` (a database id). They work and are canonical; they are just not human-readable. The one
  account that has a slug has no public article yet.
* Slugs are only set when an account is created from the editorial Users screen (`POST /api/editorial/users`,
  derived from the name) or edited there (`PATCH /api/editorial/users/[id]`). Sign-up and onboarding leave
  them empty.
* The sitemap lists every author with a public article at that same canonical address (slug, else id).

## Moving every writer to `/author/<name>` without breaking links

1. **Consent first.** These are students: confirm each writer is happy for their name to be in a URL (some
   may prefer initials). Their name already appears on the page, so this is about the address only.
2. **Dry run.** A one-off script, in the same style as `scripts/migrate-article-slugs.ts`, proposes a slug
   per writer (`slugFromTitle(name)`, de-duplicated with `-2`, `-3`) and writes a reviewable report. It
   changes nothing.
3. **Apply after owner approval.** Set `users.slug` for the approved rows. No schema change is needed
   (`slug` is already a unique, nullable column).
4. **Old links keep working automatically.** The page still resolves `/author/<id>`, and its canonical
   moves to `/author/<slug>`; the sitemap and article bylines follow on the next render, as they already
   read `slug ?? id`. For a cleaner signal, add one line to the author page: when the requested segment is
   the id and the user has a slug, `permanentRedirect('/author/<slug>')` (the article page already
   does the same for retired article addresses).
5. **Afterwards, a slug should not change.** Renaming a slug today makes the old `/author/<old>` address
   404, because there is no author redirect table. Either lock slugs once set (as articles do with
   `slugLockedAt`), or record old slugs and redirect them, like `article_slug_redirects`, before anyone
   renames one.

Known edge case: the edit route can save an empty slug (`'---'` cleans to `''`), which would make the
canonical `/author/`. No production row has one. Worth rejecting in that route when this work is picked up.
