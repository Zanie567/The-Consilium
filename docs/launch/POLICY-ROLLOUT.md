# Public access hardening — separate operator rollout

This is a review plan, not permission to change production. The audit only applies its SQL to disposable local fixtures. No application build applies this migration automatically.

Before applying the exact proposed `20261018002859_launch_public_access_hardening.sql` after owner approval:

1. Record the deployed SHA; take and verify a fresh encrypted backup and capture the safe security fingerprint. Retain the earlier verified backup.
2. Confirm the intended production project through its dashboard and read-only project identity, without printing credentials. Confirm all public tables still have RLS and anon/authenticated still lack table-level privileges. Confirm `articles_hidden_debate_guard` is enabled; the new article policy supplements that existing guard.
3. Inspect the current policies/function against the reviewed migration. Confirm no supported client calls Supabase's team table or authenticated Storage uploads directly: repository consumers use Prisma for the roster and a server service role for uploads. Integrations outside the repository were not inventoried.
4. Apply only the reviewed SQL through the established approved migration procedure. Do not run a blanket `supabase db push`: unrelated/pending migrations, particularly corrections, must be handled by their own checklist. The file is transactional and repeatable; track its registry entry through the established procedure.
5. Read-only postconditions: function `proconfig` includes `search_path=pg_catalog`, invoker security is unchanged, articles require PUBLISHED + no deletion/hidden marker, team direct policy is false, alternate Storage INSERT policy is absent. Re-run security advisors; INFO no-policy results on server-only tables are expected. Confirm remaining Storage policies do not reopen client writes.
6. Verify ordinary public home/category/team/article rendering and an authorised editorial upload through the app. Use isolated test fixtures for anonymous adversarial reads; do not inspect withdrawn production content to demonstrate a leak. Confirm the corrections schema independently through its existing rollout checklist.

The app and policy changes do not modify or delete content. If a precondition differs, stop and review; do not weaken authorization to make the rollout pass. Reverting the policy intentionally reopens the identified exposure, so fix forward is preferred. A code rollback does not undo database policy changes. Never restore an old full database to undo this migration.
