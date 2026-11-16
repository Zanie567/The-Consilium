# Tag cleanup report — 15 November 2026

Prepared for the editors before the tag taxonomy ships. **Nothing here has been changed.** Every
action below is a proposal for an editor to accept or reject in `/editorial/tags` once the migration
is applied; merges are reversible from the dashboard, renames keep each tag's address.

## Source and limits

- Read from the **public site** (archive topic filter and each `/tag/<slug>` page, 15 Nov 2026):
  30 topics on 16 published articles. A direct read-only query of the production database was not
  run (it needs the owner's go-ahead), so tags used only on drafts, scheduled or trashed articles,
  and tags with no articles, are **not** covered. Run `docs/tags/audit.sql` (read-only) to complete it.
- Duplicate detection used the same rules as the dashboard (`src/lib/tags/taxonomy.ts`): identical
  identity is already impossible (unique index since 20261006153514), so it looks for same words,
  near-identical spelling, abbreviations and containment. Meaning-level overlap is an editorial call.

## Findings

| # | Finding | Tags (published articles) | Proposal | Confidence |
|---|---------|---------------------------|----------|------------|
| 1 | Display name not capitalised like the others | `energy` (2), `sustainability` (3) | Rename to **Energy**, **Sustainability**. Same identity, so the slug and URL do not change and no alias is created. | Safe |
| 2 | Tag duplicates a format | `News` (2) — "News" is also a format (category) | Retire the **News** tag (articles keep it; its page keeps working), and rely on the News format. Or keep, if it is meant as "news analysis". | Editorial decision |
| 3 | Very broad tag overlapping narrower ones | `Policy` (2) vs `Economic Policy` (1), `International Policy` (1) | Look at the two "Policy" articles. If they are economic policy, merge **Policy → Economic Policy**. Otherwise give "Policy" a description or retire it. | Flagged by detector; needs reading |
| 4 | Related market topics | `Finance` (2), `Investing` (2), `Stocks` (1) | Possibly fold **Stocks → Investing**. Keep Finance separate (wider). Do not merge without reading the articles. | Ambiguous: do not auto-merge |
| 5 | Ambiguous abbreviation | `US` (1), `AI` (3) | Keep both. Add aliases so writers find them: **AI** ← "Artificial Intelligence"; **US** ← "United States", "USA". | Safe (aliases only) |
| 6 | Single-use tags | 20 of 30 topics have one published article (Academia, Behaviour, Collusion, COP31, Development, Discrimination, Economic Policy, Education, Game Theory, Gaming, International Policy, New Keynesian, Nvidia, Patents, Pharmaceuticals, Regulation, Sanctions, Stocks, Ticketing, US) | Normal for a young publication. Review once there are ~50 articles; prefer retiring over deleting. Consider whether **Nvidia** (a company) and **COP31** (an event) should be tags or just words in the text. | Informational |
| 7 | Unrelated look-alikes | `Gaming` / `Game Theory`; `Politics` / `Policy` | No action: different topics. Listed so nobody merges them. | Do not merge |

## Proposed order

1. Apply migration `20261115120000_tag_taxonomy.sql` (after backup), deploy.
2. Run `docs/tags/audit.sql` read-only; add anything it finds that the public site could not show.
3. In `/editorial/tags`: renames (1) and aliases (5) — no article or URL changes.
4. Editors decide 2, 3 and 4 after reading the articles. Each merge shows how many articles move
   and can be undone from the "Merged" list.

## What a merge does (and does not) do

- Moves every article link from the old tag to the new one in one transaction; articles that had
  both keep one link.
- The old tag stays (retired, pointing at the new one): `/tag/<old>` answers **308** to `/tag/<new>`,
  and `/archive?tag=<old>` still matches the moved articles. The sitemap lists only tags with articles,
  so the old URL drops out of it naturally.
- The old tag's aliases move to the new tag; the old name keeps resolving to the new tag in the editor.
- Recorded in the audit log with the exact links moved, which is what "Undo merge" restores.
