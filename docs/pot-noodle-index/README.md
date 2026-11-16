# The Pot Noodle Index page

`/pot-noodle-index` is static: everything it says comes from `src/lib/potNoodleIndex.ts`.

## Turning on the form

The form is set (supplied 15 November 2026 as `https://forms.gle/BtUh9CnvYPGLFD9E7`). To change it, set
`POT_NOODLE_INDEX.form.responderUrl` to the form's **responder** link, the one that ends in
`/viewform`: `https://docs.google.com/forms/d/e/<id>/viewform`. Then:

- the page shows "Open in Google Forms" and the embedded form;
- the form is **not** loaded on first view (no Google scripts or cookies): it loads when a visitor clicks
  "Load the form here", follows "Add your prices" (`#take-part`), or has accepted cookies and scrolls near it;
- a `forms.gle` short link works as a direct link but cannot be embedded; use the long link to get both.

The Content-Security-Policy already allows `https://docs.google.com` frames (next.config.ts). In the
form's settings, make sure responses do not require a Google sign-in if you want anyone to answer.

## Publishing results

Leave `results.published` false until the methodology, data source and validation rules are agreed.
To publish, replace `results` with a `PublishedResults` object: the unit a value reads in ("index
points", "£ per week"), decimals, dates, response count, the minimum responses per place, the series,
the places (cities, universities or countries) and the methodology lines. The contract is deliberately
unit- and currency-neutral: what the index measures and how currencies are compared is a methodology
decision. `publishableResults()` withholds the whole set if
anything is missing or inconsistent, so a half-filled entry shows nothing rather than a wrong number.
There is no automated pipeline: figures are entered here after review, and deployed like any change.

## Navigation

"Pot Noodle Index" has its own entry in the header (`navLinks` in `src/components/layout/Navbar.tsx`),
separate from the Trading Challenge, and in the footer.
