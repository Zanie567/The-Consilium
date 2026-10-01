-- =============================================================================
-- One-off data step: link EXISTING Meet the Team cards to their accounts
-- Date: 2026-10-01          Run AFTER 20261001_team_member_user_link.sql
-- =============================================================================
--
-- WHY: legacy cards were typed in by an admin and carry no email, so nothing ties
-- them to an account. Without this step, an existing member opening Team Profile
-- would be offered "Create" and appear on the page twice. Linking sets
-- team_members."userId" on the EXISTING row, so their title, order, photo and bio
-- are kept and no second card is ever created.
--
-- RULE (deterministic, no fuzzy matching): a card is linked only when
--   * it is not linked yet,
--   * its name equals exactly one account's name after trimming, collapsing
--     whitespace and lower-casing — across ALL accounts of any role, so a
--     same-named reader makes the match ambiguous and it is skipped,
--   * exactly one unlinked card has that name,
--   * that account is active, not banned, not an internal test account, has a
--     team role (WRITER / EDITOR / GROWTH — ADMIN has no team, so an admin's card
--     stays an unlinked legacy card) and has no card yet,
--   * the card's title fits the account's team. The account role ALONE decides the
--     team; a title never overrides it. Linking a card whose title belongs to a
--     different team (e.g. "Editor-in-Chief" on a WRITER account) would silently
--     move that person on the public page, so it is SKIPPED and reported: fix the
--     account's role first (an Editor-in-Chief account should be EDITOR), re-run.
--     Fit means: blank title, or EDITOR ~ 'editor', WRITER ~ writer/contributor/
--     columnist/correspondent/journalist/reporter, GROWTH ~ growth/communications/
--     comms/social/marketing/outreach.
-- Anything else is left untouched and listed by the report query for a human.
--
-- USAGE (Supabase SQL editor):
--   1. Run STEP 1. Read every row. Only 'LINK' rows will be changed.
--   2. Run STEP 2 (one transaction). It re-derives the same set and prints what it did.
--   3. Resolve each 'SKIP' row by hand with STEP 3 once you have confirmed with the person.
-- Re-running is harmless: linked cards no longer match the rule.
-- =============================================================================

-- STEP 1 — PREVIEW (read-only)
WITH norm AS (
  SELECT id, "userId", name, role AS title,
         lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key
  FROM team_members
),
acct AS (
  SELECT id, name, role, email, "isActive", "isBanned",
         lower(btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))) AS key
  FROM users
),
cand AS (
  SELECT n.id AS card_id, n.name AS card_name, n.title, a.id AS user_id, a.role::text AS account_role,
    (SELECT count(*) FROM acct a2 WHERE a2.key = n.key)                          AS accounts_with_name,
    (SELECT count(*) FROM norm n2 WHERE n2.key = n.key AND n2."userId" IS NULL)  AS unlinked_cards_with_name,
    (a.role IN ('WRITER','EDITOR','GROWTH') AND a."isActive" AND NOT a."isBanned"
       AND lower(a.email) NOT LIKE 'test-%'
       AND NOT EXISTS (SELECT 1 FROM team_members t WHERE t."userId" = a.id))    AS account_ok,
    (btrim(n.title) = '' OR CASE a.role::text
         WHEN 'EDITOR' THEN n.title ~* 'editor'
         WHEN 'WRITER' THEN n.title ~* '(writer|contributor|columnist|correspondent|journalist|reporter)'
         WHEN 'GROWTH' THEN n.title ~* '(growth|communications?|comms|social|marketing|outreach)'
         ELSE false END)                                         AS title_fits
  FROM norm n
  LEFT JOIN acct a ON a.key = n.key
  WHERE n."userId" IS NULL
)
SELECT card_name, title,
       CASE WHEN user_id IS NULL THEN 'SKIP: no account with this exact name'
            WHEN accounts_with_name <> 1 OR unlinked_cards_with_name <> 1 THEN 'SKIP: ambiguous'
            WHEN NOT account_ok THEN 'SKIP: account not eligible (no team role / test / already has a card)'
            WHEN NOT title_fits THEN 'SKIP: title does not fit the account''s team: fix the account role'
            ELSE 'LINK' END AS action,
       account_role
FROM cand ORDER BY action, card_name;

-- STEP 2 — APPLY
BEGIN;
WITH norm AS (
  SELECT id, role AS title, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS key
  FROM team_members WHERE "userId" IS NULL
),
acct AS (
  SELECT id, role, email, "isActive", "isBanned",
         lower(btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))) AS key
  FROM users
),
pairs AS (
  SELECT n.id AS card_id, a.id AS user_id
  FROM norm n JOIN acct a ON a.key = n.key
  WHERE (SELECT count(*) FROM acct a2 WHERE a2.key = n.key) = 1
    AND (SELECT count(*) FROM norm n2 WHERE n2.key = n.key) = 1
    AND a.role IN ('WRITER','EDITOR','GROWTH') AND a."isActive" AND NOT a."isBanned"
    AND (btrim(n.title) = '' OR CASE a.role::text
         WHEN 'EDITOR' THEN n.title ~* 'editor'
         WHEN 'WRITER' THEN n.title ~* '(writer|contributor|columnist|correspondent|journalist|reporter)'
         WHEN 'GROWTH' THEN n.title ~* '(growth|communications?|comms|social|marketing|outreach)'
         ELSE false END)
    AND lower(a.email) NOT LIKE 'test-%'
    AND NOT EXISTS (SELECT 1 FROM team_members t WHERE t."userId" = a.id)
)
UPDATE team_members t SET "userId" = p.user_id
FROM pairs p WHERE t.id = p.card_id
RETURNING t.name, t.role AS title, t."userId";
COMMIT;

-- STEP 3 — MANUAL, per person, after confirming with them (not run automatically):
--   UPDATE team_members SET "userId" = '<account id>' WHERE id = '<card id>' AND "userId" IS NULL;
-- The unique index rejects it if that account already has a card.
