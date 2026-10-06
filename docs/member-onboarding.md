# Member onboarding

How a new Consilium member goes from "hired" to "on the Our Team page", and what happens when
they are promoted or leave. Code: `src/lib/membership.ts` (all rules), `src/app/api/admin/members/**`
(admin API), `/editorial/members` (admin screen), `src/lib/emailVerification.ts` +
`/verify-email` (address proof). Migration: `supabase/migrations/20261006_member_onboarding.sql`
(apply manually, like the others; idempotent).

## Two concepts that never mix

| | Stored in | Set by | Means |
|---|---|---|---|
| **Authorisation role** | `users.role` (mirrored in `team_memberships.role`) | admins only | what the account may do (`ADMIN` `EDITOR` `WRITER` `GROWTH`; `READER` = none) |
| **Public position / team / order / visibility** | `team_members.role` / `.team` / `.order` / `.isActive` | admins only | what the Our Team card says and where it sits |

Changing one never changes the other. A promotion changes permissions, not the card. An `ADMIN`
account keeps its public position ("Deputy Editor"); the page never prints a permission role.

## Existing architecture this builds on (not replaced)

NextAuth v4, JWT sessions, Prisma. Google (verified email only) and email + password. `users.role`
is what every gate already reads (`requireVerifiedSessionUser`, the portal layout, `rbac.ts`), so it
stays the source of truth for access; `team_memberships` adds the pre-authorisation and the audit
trail in front of it. Sign-up still creates a `READER`, always.

## The flow

1. **Admin adds the person** — Editorial portal → *Members* → email + access role (+ optional
   public position / team). Works before they have an account. Stored as `PENDING`, one row per
   email (unique, lower-cased), so a second invitation updates the same row.
2. **They sign up or sign in** with that email (password or Google). Until the address is proven
   they are a plain reader.
3. **Address proven** by any of: Google `email_verified`; the emailed confirmation link
   (`/verify-email`, from the notice on `/profile`); completing a password reset.
4. **Claim** (`claimInvitationForUser`): in one transaction, the `PENDING` row for *that account's own
   email* becomes `ACTIVE`, `users.role` is set, a hidden Team Profile card is created (or an
   unambiguous legacy card with their email is adopted), and an audit row is written.
5. **Dashboard** — role-gated pages and APIs work immediately (the portal reads the role from the
   database; the cached JWT catches up within a minute).
6. **Dashboard prompt** — "Complete your team profile / Profile incomplete" until name, photo and
   description exist. Optional.
7. **Member edits** name, photo, description at `/editorial/team-profile`. Nothing else.
8. **Admin sets** position, team, order and visibility on the Members screen.
9. **Public** — a card appears only when it has a name, description, position and team **and** is
   visible. Photo is encouraged (part of "complete") but not required; the card draws initials.

## Existing account, hired later

Admin adds the same email. If the account's address is already verified the role applies
immediately (`outcome: "activated"`). If not, it stays `PENDING` and shows "Registered, email not
confirmed" until the owner confirms. The admin can also assign a role straight to an account from
the existing user list (`PATCH /api/admin/users/:id/role`), which now goes through the same module.

## Role changes

`setMemberRole` updates `users.role` and the membership row and writes `USER_ROLE_CHANGED` in one
transaction. The card is not touched; its team is pinned first so it cannot move sections as a side
effect. Changing the role while the invitation is still `PENDING` just edits the one row.

## Leaving

*Revoke access* (`POST /api/admin/members/:id/revoke`): `users.role` → `READER`, membership →
`REVOKED`. Nothing is deleted. The card is left exactly as it was unless the admin ticks "also hide
the public profile"; visibility can be changed independently any time afterwards. A revoked email
cannot re-claim by signing in; reinstating is an explicit admin action. Deleting an account marks its
membership `REVOKED`. The last active administrator cannot be demoted or revoked.

## Why this is safe

* No route accepts a role for oneself. Sign-up ignores any `role`; `PUT /api/team-profile` **rejects**
  (400) `role`, `team`, `position`, `order`, `isActive`, `visible`, `userId`, … ; every
  `/api/admin/members*` route is `ADMIN_ONLY` (role re-read from the database) and allow-lists its fields.
* Identity is the account's own database email, never a request value: `claimInvitationForUser(userId)`
  has no email parameter. Matching is case/space-insensitive; Google emails are lower-cased.
* **Verified address required.** Password sign-up does not verify the address, so an unconfirmed
  account never claims an invitation (otherwise anyone could register an invited person's email).
* **Pre-registration guard.** If an unconfirmed password account exists for an invited address, Google
  sign-in is refused (`/login?error=VerifyEmailFirst`) rather than merged into it, so a squatter's
  password cannot survive onto the real owner's elevated account. Resetting the password (which proves
  the inbox) resolves it.
* Idempotent and race-safe: unique `email`, unique `userId`, claim guarded by `status = PENDING`
  (`updateMany` count), card creation `skipDuplicates`. Tested with simultaneous sign-ins/claims/invites.

## Tests

* `tests/unit/membership.test.ts`, `tests/unit/team-profile-accounts.test.ts` — pure rules.
* `tests/integration/member-onboarding.test.ts` — the lifecycle for Writer, Editor and Growth, the
  existing-account, role-change, admin-with-position, revoked and security cases, against real
  Postgres with the real NextAuth callbacks and route handlers.
* `tests/e2e/member-onboarding.spec.ts` — the same journey in a browser (`scripts/run-team-profile-e2e.sh`).
