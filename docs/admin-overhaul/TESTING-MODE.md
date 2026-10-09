# Testing Mode: why it says "unavailable", and how to use it

## Why the live site says "Unavailable: Testing mode is disabled. Configure a verified isolated workspace."

That message is correct, and it is a safety rule rather than a fault. Testing Mode signs in as
dedicated test accounts and *writes real data* (articles, profiles, notifications, uploads, mail).
It therefore refuses to run anywhere that is not a verified, disposable workspace, and the live
site is deliberately never one of them. It is switched on only when **all** of these hold, checked
by `testingConfigurationError` in `src/lib/testingMode.ts`:

| Requirement | Variable(s) |
|---|---|
| Switched on | `TESTING_MODE_ENABLED=1` |
| Only a disposable local database | `TEST_DATABASE_URL`, equal to `DATABASE_URL` and `DIRECT_URL`, on this machine (or the reviewed hosted project) |
| App, site and storage are local | `NEXT_PUBLIC_SUPABASE_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL` |
| Email captured, outside integrations off | `EMAIL_TRANSPORT=capture`, `EMAIL_CAPTURE_FILE`; no `RESEND_API_KEY`, Google, FRED or Alpha Vantage keys |
| Workspace identity | `TESTING_WORKSPACE_ID`, matching the marker row the seed script writes |

At runtime the database must also carry that marker (`requireTestingWorkspace`). Nothing in this
repository weakens, bypasses or short-circuits those checks, and the overhaul added none.

The Testing page now lists each requirement with a tick or cross (variable names only, never
values), so an unavailable workspace tells you what is missing. The checklist's "ready" is derived
from the same guard function, so it cannot report ready while the guard refuses.

## Using it

1. Start an isolated workspace (see below) and open `/admin/testing` on it.
2. Optionally apply a **scenario** to a persona (Scenarios section). Scenarios only touch the five
   test accounts, are repeatable, and **Reset** restores the persona exactly (the persona's own
   Meet the Team profile is snapshotted before the first change and restored byte for byte).
3. Choose **Test as Writer / Editor / Growth** (or *Other Writer*, *Global Editor* for ownership and
   scope boundaries). The banner names the environment and persona. The session lasts 15 minutes.
4. Walk the persona's dashboard. Each scenario lists what must and must not appear.
5. Press **Check access** to try administrator-only pages and APIs as the persona against the real
   server; every row should read *Pass*.
6. **Exit testing mode** returns to the administrator view.

### Scenarios

| Scenario | Sets up | The persona should |
|---|---|---|
| Newly registered member | no profile, no scenario content | see "Complete your team profile", no notification count |
| Member with no linked public profile | removes the profile (restored on reset) | see the prompt and an empty profile form |
| Member with a completed profile | name, photo and description present | not see the prompt |
| Writer with a draft | one draft | see it in My Drafts |
| Writer with an article submitted for review | one pending article | see it as pending, with no publish control |
| Editor with articles awaiting review | two pending Opinion articles by the second writer | see both in the review queue |
| Unread notifications | three unread | see 3 on the bell |
| Dismissed notifications | three read | see no unread count |
| First published article | unseen first-publish achievement | see the one-time banner |
| Restricted functionality | nothing (use Check access) | be refused administrator pages and APIs |

Note the personas are long-lived fixture accounts, so "newly registered" means *in the state of a
new account for the things Testing controls* (profile, notifications, scenario content); fixture
articles the account already owns are not deleted.

## Starting an isolated workspace

```sh
PGPORT=55435 PGDATA=/tmp/consilium-testing-pg npm run test:setup-db
TEST_DATABASE_URL=postgresql://postgres@localhost:55435/consilium npm run testing:workspace
```

The launcher sets every variable above, builds the app on localhost, and serves it. Sign in as the
seeded test administrator and open `/admin/testing`. Details, the hosted workspace and the
operator runbook are in `docs/testing/appointments-and-testing-mode.md`.

To offer a link from the live site to a separately hosted workspace, set `TESTING_WORKSPACE_URL` to
that workspace's bare origin. It adds a link only; it does not enable anything, and you sign in
independently there.

## Pointing the hosted workspace at this code

The hosted testing deployment runs its own copy of the app against its own database. Before the new
screens work there it needs this branch deployed **and** the two additive migrations applied to *its*
database (never production's):

* `supabase/migrations/20261010_debate_lifecycle.sql`
* `supabase/migrations/20261010_team_member_updated_at.sql`

`/api/admin/deployment-health` (and the overview's Deployment card) reports either as
`Missing schema: …` until applied.
