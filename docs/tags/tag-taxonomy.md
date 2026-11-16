# Tag taxonomy

Tags are a controlled vocabulary. Writers and editors **choose** approved tags; only tag managers
create, rename, merge and retire them. Introduced by `feat/tag-taxonomy` (migration
`20261115120000_tag_taxonomy.sql`).

## Who can do what

| | Choose tags | Suggest a tag | Create / rename / alias / merge / retire / review suggestions |
|---|---|---|---|
| Writer, Editor | ✓ | ✓ | — |
| Administrator (`TAG_MANAGE_ROLES`) | ✓ | — | ✓ |

To let editors manage tags, add `'EDITOR'` to `TAG_MANAGE_ROLES` in `src/lib/rbac.ts` (nothing else).
Every check is on the server: the `/api/editorial/tags*` routes, the article-save routes (an
unknown name from a non-manager is refused with `TAG_NOT_APPROVED`) and the `/editorial/tags` page.

## Rules

- **One identity.** `canonicalTagSlug` (JS) = `public.consilium_tag_identity` (SQL). A wording names
  at most one tag: tag names and aliases share one identity space, enforced by unique indexes and
  the `tags_alias_guard` / `tag_aliases_guard` triggers.
- **Addresses are permanent.** A slug never changes. Renaming changes the display name only (the old
  wording becomes an alias). Merging leaves the old tag as a redirect.
- **Nothing is deleted.** Retire instead; merge for duplicates. Both are reversible.
- **Limit.** `MAX_ARTICLE_TAGS = 10` (editor and server); 1–3 recommended. An article saved earlier
  with more may keep them but not gain more.
- **Saving resolves names**: exact tag → merged tag's target → alias → (manager only) create. A retired
  tag stays on articles that have it but cannot be added.

## Applying the migration (owner)

1. Backup: `scripts/backup/take-supabase-backup.sh --out /Volumes/ConsiliumBackup` (mount the encrypted
   volume first).
2. `bash scripts/ops/apply-tag-taxonomy.sh` from the repository root, **before** deploying the code. It
   reads the connection string without echoing it, refuses any database but production, runs a
   read-only preflight, applies the migration in one transaction, verifies every object and that no
   existing tag or article link changed, and records the version in the migration registry. It is safe
   to run twice.
3. Merge (which deploys).

Rollback: deploy the previous code, then `supabase/manual/20261115120000_tag_taxonomy_rollback.sql`.
Undo any merges first if their articles should go back (see the file header).

## Notes

- A merge or undo changes articles' tag lists, so an editor with that article open gets the usual
  "changed elsewhere" conflict on their next save, and reloads. Merges are rare; this is the safe outcome.
- Public caches (tag, archive, article pages) are expired after rename, retire/restore, merge and undo.
- Cleanup proposals: `docs/tags/cleanup-report-2026-11-15.md`. Read-only audit: `docs/tags/audit.sql`.
