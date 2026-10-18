# Backing up the production database on your Mac, and proving the backup is good

**Do this before any change that could damage data (a migration, a bulk edit, a clean-up job) and from time to time in between.** Supabase's Free plan takes no automatic backups, so this is the only way back if something goes wrong.
Nothing here changes production: it only reads. It costs nothing (every tool is free) and takes about 30 to 40 minutes the first time, less afterwards (steps 1 to 3 are one-off). The database was about 15 MB in October 2026; check the size of the newest backup folder before assuming the 200 MB volume in step 3 still has room.

> **The backup is full of personal data** (subscriber and user emails, password hashes, admin notes, contact messages, login IP addresses). It must be encrypted at rest, never uploaded anywhere unencrypted, never committed, and deleted when it is no longer needed (step 11).
> **The connection string is the keys to the database.** Treat it like the password it contains. Never paste it into chat, a ticket, a document or a screenshot, and never type it on a command line.

## Status (evidence inspected 2026-10-18)

* **Most recent evidenced verified backup:** `consilium-prod-20261016T135715Z`. On the encrypted volume,
  `counts/20261016T135434Z/verify-output.txt` records `RESULT: VERIFIED` (19 checks, zero failures), and
  `counts/20261016T135434Z/restore/summary.txt` records `RESULT: RESTORE VERIFIED`: 41 public tables, matching
  row contents, zero orphan rows across 43 foreign keys, matching security and critical fingerprints. This is
  historical verification evidence inspected read-only; the launch audit did not open dumps or perform a restore.
* The mounted outer image reports `image-encrypted=true`, and backup/asset directories are owner-only (0700).
  The example `~/ConsiliumBackup.sparsebundle` path below does not exist on this machine; locate the existing
  mounted image through Disk Utility before attaching anything. **Never create a replacement merely because
  the example path differs.** Independent passphrase access and an off-device second copy were not verified.
* The 9, 13 and 14 October backups also remain. Keep historical backups according to the retention procedure;
  the 13 October copy predates the seed-vote cleanup and must never be restored casually to production.
* **Storage copy:** `storage-20261015T145909Z` contains 41 objects (9,860,402 bytes). On 18 October every
  local file's path, byte length and MD5 matched its inventory. Production now has 44 objects, so this older
  copy does not establish complete recovery of today's assets. Nothing was downloaded or uploaded by this audit.
* **Current recovery point:** database 16 October; assets 15 October. Supabase Cron activation followed the
  database backup, so recovery must also recreate scheduler infrastructure, Vault configuration and jobs using
  the separate scheduler guide. Take and verify a fresh encrypted database and Storage copy before launch.
* **Hosted recovery remains unproven.** Issue [#132](https://github.com/Zanie567/The-Consilium/issues/132)
  records the owner's deferral. The file labelled `hosted-dry-run-143452/summary.txt` targets loopback
  `localdryrunxxxxxxxxx`; it is a local simulation, not evidence of hosted recovery. No hosted restoration,
  credential change or production change was performed for this audit.

## How the scripts were tested

* **Unit tests** (`tests/unit/backup-scripts.test.ts`, Bash 3.2 as shipped with macOS): credential handling, refusals, and every way the verifier must fail. A stand-in `supabase` program now enforces the real CLI's flag rules, including that errors arrive on standard output.
* **Contract test against the installed CLI**: the same file replays the exact flags the script uses through the real `supabase db dump --dry-run` (no connection, no Docker). It fails if a CLI upgrade rejects those flags, and it is skipped if the CLI is not installed.
* **Local end-to-end test** (`scripts/backup/local-integration-test.sh`, needs Colima or Docker Desktop): starts a disposable Supabase Postgres container with TLS and a pooler-style login, runs the real CLI through `take-supabase-backup.sh`, runs the verifier, restores into a second disposable container (a full restore, which works there because the throwaway source has the image's own platform schemas), verifies against the restored counts, and confirms the verifier rejects a mismatch. Last run: Supabase CLI 2.120.0, image `supabase/postgres:17.11.0.004`, all checks passed. It never contacts production and removes only the containers it created. **Run it again after upgrading the Supabase CLI.**

* **Restore rehearsal** (`scripts/backup/restore-rehearsal.sh`, step 8): run on 2026-10-14 against the real 13 October production backup, three times with identical results, under the Bash 3.2 that macOS ships; its refusals are unit-tested in `tests/unit/backup-rehearsal-scripts.test.ts`.

Every failure message tells you what to do, and the verifier refuses to call a doubtful backup good.

---

## 1. Install the tools (free)

Colima is a free, open-source container runtime (Docker Desktop and OrbStack carry licence conditions; Supabase lists Colima as supported). The Supabase CLI needs one because it runs `pg_dump` inside a container.

```bash
brew install colima docker supabase/tap/supabase
colima start --cpu 2 --memory 2 --disk 20
docker version          # must show BOTH a Client and a Server section
supabase --version
```

If a later step says it cannot reach the Docker daemon, run `colima status`; the backup script also finds Colima's socket for itself.
The first dump downloads a Supabase Postgres container image (a few hundred MB, free). To stop Colima afterwards: `colima stop`.

## 2. Get the tools onto your Mac without touching your working repository

```bash
git clone --depth 1 --branch main --single-branch https://github.com/Zanie567/The-Consilium.git ~/consilium-backup-tools
cd ~/consilium-backup-tools
```

(For a later backup, `git -C ~/consilium-backup-tools pull` refreshes it. Re-read the scripts if they changed.)

The scripts are short (`scripts/backup/`); read `take-supabase-backup.sh` and `verify-supabase-backup.sh` before you run them. Neither contacts anything except the database (the first) and nothing at all (the second).

## 3. Make an encrypted place for the backup (first time only)

**If `~/ConsiliumBackup.sparsebundle` already exists, skip the `create` command: it already holds earlier backups. Only run `attach`, and keep every earlier backup folder where it is.**

```bash
diskutil image create blank --encrypt --format UDSB --size 200m --volumeName ConsiliumBackup --fs APFS ~/ConsiliumBackup.sparsebundle
```

It asks for a passphrase twice (typing is hidden). Put the passphrase in your password manager; **if you lose it the backup is unrecoverable by design**. Then open it:

```bash
diskutil image attach ~/ConsiliumBackup.sparsebundle      # asks for the passphrase; it mounts at /Volumes/ConsiliumBackup
```

If a macOS dialog offers to remember the passphrase in your keychain, **untick it**. (`~/ConsiliumBackup.sparsebundle` lives in your home folder, not in Desktop or Documents, so iCloud does not sync it.) Make sure FileVault is on (System Settings > Privacy & Security); the backup script warns if it is not.

Each backup gets its own folder for the live-row-count files, so a new backup never overwrites the evidence for an older one. In the terminal window you will use for steps 5 to 8, set it once (the folder is named after the time, to the second):

```bash
RUN=$(date -u +%Y%m%dT%H%M%SZ); C=/Volumes/ConsiliumBackup/counts/$RUN; mkdir -p "$C"; echo "$C"
```

## 4. Find the connection string without revealing the password

The password you need is the one the live site already uses. **Do not reset the database password**: the live site's connection string contains it, so a reset would take the site down until Vercel is updated.
The `.env.local` file in your main checkout of the repository already holds it. Set the path once (change it to wherever your checkout is; it is a local file that is never committed):

```bash
ENVFILE=~/The-Consilium/.env.local
```

This command shows only the variable name, user, host and port; the password is never printed:

```bash
sed -nE "s#^(DIRECT_URL|DATABASE_URL)=[\"']?postgres(ql)?://([^:]+):[^@]*@([^:/]+):([0-9]+)/.*#\1  user=\3  host=\4  port=\5#p" "$ENVFILE"
```

Read the result:

| You see | Meaning | Do this |
|---|---|---|
| `host=aws-0-….pooler.supabase.com  port=5432` | session pooler: ideal | use that variable |
| `host=aws-0-….pooler.supabase.com  port=6543` | transaction pooler | fine: the script switches it to 5432 itself (pg_dump cannot use 6543) |
| `host=db.scllbuwkcqtmfogsgalt.supabase.co  port=5432` | direct host, **IPv6 only on the Free plan** | try it; if the script says it cannot reach the host, your network is IPv4-only: you need the session pooler string |
| nothing printed, or the variable is missing | the file has no such line | see below |

If you need the session pooler string: Supabase Dashboard > **Connect** > **Session pooler** shows it with a `[YOUR-PASSWORD]` placeholder; the password is the one already in your `.env.local` (percent-encode special characters such as `@` as `%40`).
If you do not have the password anywhere, **stop and ask the maintainer**: obtaining it means resetting it, which is a production change that must be coordinated with a Vercel update and a redeploy, and needs explicit approval.

The script then protects the string for you: it reads it silently (or from the file, without printing), refuses any project other than `scllbuwkcqtmfogsgalt`, refuses any host that is not Supabase, strips Prisma-only query parameters such as `?pgbouncer=true` (which `pg_dump` rejects), forces TLS, and never writes it anywhere.

## 5. Capture the live row counts BEFORE

Supabase Dashboard > **SQL Editor** > new query. Paste the contents of `scripts/backup/table-row-counts.sql` (one read-only `SELECT`), click **Run**, then use **Export** > **CSV** and save the file as:

```
/Volumes/ConsiliumBackup/counts/<the RUN folder from step 3>/before.csv      (that is "$C/before.csv")
```

It lists every table in the database and its exact row count: names and numbers only, no personal data. The verifier checks **every table in this export**, so tables added by later migrations are covered automatically. If a file with that name already exists, you picked the wrong folder: stop, and make a fresh `RUN` folder instead of overwriting.

## 6. Take the backup

From `~/consilium-backup-tools`:

```bash
scripts/backup/take-supabase-backup.sh --out /Volumes/ConsiliumBackup --url-from-env-file "$ENVFILE" --var DIRECT_URL
```

(Use whichever variable step 4 showed is best; or leave off the last two options and paste the string at the hidden prompt.)
You should see, in order: the CLI version, `Target: user=… host=… port=… (password hidden, TLS required)`, then `-> schema`, `-> data`, `-> roles`, and finally `Backup written to: /Volumes/ConsiliumBackup/consilium-prod-<timestamp>`. It takes one to three minutes. It creates, owner-only: `schema.sql`, `data.sql`, `roles.sql`, `MANIFEST.sha256`, `MANIFEST.txt`, `backup.log`.
It says "NOT yet trustworthy" on purpose: the next steps decide that.

**Immediately afterwards**, repeat step 5 and save the export as `$C/after.csv`. (Rows written while the dump ran are why there is a before and an after.)

If it fails, nothing is verified. The message names the likely cause; the common ones are in the table at the end.

## 7. Verify the files and the row counts

```bash
scripts/backup/verify-supabase-backup.sh /Volumes/ConsiliumBackup/consilium-prod-<timestamp> \
  --counts-before "$C/before.csv" \
  --counts-after  "$C/after.csv" | tee "$C/verify-output.txt"
```

It must end with **`RESULT: VERIFIED`**. It checks that: all five files exist and are owner-only; the SHA-256 of each matches the manifest; `schema.sql` and `data.sql` end with `pg_dump`'s completion marker (not cut short); no file contains a connection string or a role password; `schema.sql` defines every table in the live counts (the 37 core tables it always requires, plus any added since) and `data.sql` has a data block for each; and, for every one of those tables, the number of rows **actually inside the backup** lies between the live counts you took before and after. It compares row *counts*, not row contents; the restore in step 8 is the stronger proof.
Any `FAIL` ends with `NOT VERIFIED`, exit status 1: **do not continue.** A `MISMATCH` row names the table; a busy table can drift (re-take both counts and the backup in a quiet minute), but a table like `users` or `subscribers` that differs means rows are missing or extra and must be understood first.

## 8. Strongest check: restore it into a throwaway database and compare it with production

`scripts/backup/restore-rehearsal.sh` does this in one command. It starts a disposable Supabase Postgres container
(no published port; removed afterwards), restores the backup into it, checks it, and writes owner-only evidence. It
never connects to a hosted database and prints no row contents.

First, in the Supabase SQL editor, run `scripts/backup/security-fingerprint.sql` and `scripts/backup/critical-fingerprint.sql`
on production (both read-only; names, counts and md5s only) and export each as CSV into `$C`, as
`prod-fingerprint.csv` and `prod-critical.csv`. Take `prod-critical.csv` straight after the backup, with `after.csv`.

```bash
B=/Volumes/ConsiliumBackup/consilium-prod-<timestamp>
scripts/backup/restore-rehearsal.sh "$B" --evidence "$C/restore" \
  --expected-fingerprint "$C/prod-fingerprint.csv" --expected-critical "$C/prod-critical.csv"
```

It must end with **`RESULT: RESTORE VERIFIED`**. What it checks:

1. **Strict restore of the public schema**: `schema.sql`, then `data.sql` with triggers and foreign-key checks off
   (`session_replication_role = replica`), all in **one transaction with `ON_ERROR_STOP`**, so any error restores nothing.
2. **Row counts**: the verifier against the restored copy's counts; they must equal the rows inside the backup exactly.
3. **Row contents**: for every table, the sorted rows in `data.sql` and in the restored table have the same md5.
4. **Referential integrity**: no foreign key has an orphan row.
5. **Security**: `anon` and `authenticated` hold no table privilege, and every line of the security fingerprint (tables,
   RLS, table and column grants, policies, functions and their EXECUTE grants, triggers, constraints, indexes, schema
   and default privileges) equals production's. The extension list is shown but not compared (the image and the hosted
   project ship different extension versions).
6. **Critical content**: the counts and id fingerprints of articles, public articles, users, debates, public debates,
   votes, subscribers, team members, comments and audit log entries equal production's.

**Why only the public schema, and why the old step 8 failed.** `data.sql` also holds the data of Supabase's platform
schemas (`auth`, `storage`). Those tables are created and migrated by the Auth and Storage services, not by the
Postgres image, so a bare `supabase/postgres` container has different (older or missing) tables and columns. Loading
everything with `ON_ERROR_STOP` therefore failed on 13 October (32 errors, all in `auth`/`storage`). The rehearsal
skips those blocks and reports how many rows it skipped (13 October backup: `auth` 26 tables, 0 rows; `storage`
7 tables, 38 rows of bucket and object *metadata*, not the files). The application keeps all of its data in `public`
and signs users in with its own tables, so the public schema is the application's complete database.

**Why privileges needed fixing, and how it is done safely.** A restore recreates the grants the dump records, but not
the *absence* of others: the Supabase image's default privileges grant `anon` and `authenticated` full rights on every
new table, while production revoked them (production: only `postgres` and `service_role` hold table privileges; `anon`
holds SELECT on 41 vetted columns of 6 public-content tables; `authenticated` holds nothing). The 13 October test
restored all 41 tables with `anon` and `authenticated` holding full privileges. The rehearsal now revokes the image's
table defaults for those two roles **before** `schema.sql` runs, so no table is ever created with them, and then
proves the result equals production's fingerprint (2026-10-14: 656 table grants, md5 `1ce2f2e6…`, identical).

The same applies to functions, found with the first backup that contains the admin-overhaul trigger functions
(`consilium-prod-20261014T214159Z`): production revokes EXECUTE on `clear_article_hidden_by_debate()` and
`prevent_hidden_debate_article_publication()` from everyone but `postgres` and `service_role` (migration
`20261012110000`), the dump records exactly that, but the image's default function privileges re-granted EXECUTE to
`anon` and `authenticated` on creation (production 19 function grants, restored 23). The rehearsal now also revokes the
image's function defaults for those two roles before `schema.sql`; the dump still grants them explicitly on the three
functions where production does, and restores production's default privileges at the end.

Rehearsal record (2026-10-14, real 13 October backup, image `supabase/postgres:17.11.0.004`, three identical runs):
strict load passed; 41/41 tables with exact counts and byte-identical rows; 43 foreign keys, 0 orphans; table grants,
column grants, RLS, policies, constraints, schema and default privileges equal to today's production. Functions,
triggers, function grants, one index and `debates."deletedAt"` differed, exactly the objects that migrations 1 to 5
added after that backup was taken; a backup taken now will include them.

If it fails for an environment reason (Docker not running, image missing), that is not by itself evidence that the
backup is bad: step 7's checks still stand. A `FAIL` on a privilege, row-content or critical line is not an
environment problem: stop and investigate.

## 9. Keep a second, verified copy

Only after step 7 (and ideally step 8) passed on the primary: eject the volume (`diskutil eject /Volumes/ConsiliumBackup`), then copy the **encrypted** bundle to a different physical drive (an external disk; not a cloud folder):

```bash
cp -R ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/
diff -r ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/ConsiliumBackup.sparsebundle && echo "copy is identical"
```

For a later backup this copies over the previous second copy. Do that only once the new backup is verified, and if you can, alternate between two external drives so one good copy always survives a bad copy run.

## 10. Record the result (with no secrets)

Keep `verify-output.txt`, the `restore/` evidence folder from step 8 (`summary.txt` and the files beside it), the production fingerprint exports and the backup's `MANIFEST.txt` with the backup (they are in `$C` and the backup folder). They contain a folder name, row counts and md5s, nothing secret (`restore/restore.log` can quote a row if a load ever fails: keep it on the encrypted volume), and are what you would show a reviewer. If someone cross-checks the numbers, they can run `scripts/backup/table-row-counts.sql` read-only against production and compare. **Never share the connection string, the password, or any part of a dump file.**

## 11. Tidy up, and how long to keep it

```bash
fc -l 1 | grep -cE 'postgres(ql)?://[^ ]*:[^ ]*@' || true   # expect 0: no connection string should be in your shell history
colima stop                                  # optional
diskutil eject /Volumes/ConsiliumBackup
```

**Retention.** A backup holds personal data, so keep it no longer than the safety it provides is needed, but never delete the only good one. A reasonable rule, for the operator to adjust: keep a backup until a newer one has been verified **and** the change it protected has run cleanly for about 30 days; keep at least one verified backup at all times.

Delete one backup at a time, by its own folder, with the volume mounted (and its counts folder if you no longer need it): `rm -r /Volumes/ConsiliumBackup/consilium-prod-<timestamp>`. **Do not delete the whole `~/ConsiliumBackup.sparsebundle`** (or the external copy) unless you are certain no backup in it is still needed, including the 9 October 2026 backup, which is the operator's to retire. When a copy on the external drive is retired, delete its bundle there too.

---

## What this backup does and does not cover

Covered: every table and row of the `public` schema (the whole application: users and their password hashes, articles,
subscribers, comments, votes, audit log, and so on), its structure, RLS policies, functions, triggers and grants, and
the cluster role *names* (`roles.sql`, no passwords).

Not covered, and needed for a full recovery:

* **Storage files.** Article images and avatars are objects in Supabase Storage (35 objects in `article-images` and
  9 in `avatars`, read-only snapshot on 18 October). The dump holds only their metadata rows; the files must be copied separately.
* **Supabase platform schemas** (`auth`, `storage`, `realtime`, `vault`, …): they belong to Supabase's services and are
  recreated by a new project, not restored from this dump. Production does not use Supabase Auth (its `auth` tables are
  empty), so nothing of the application is lost there.
* **Secrets and configuration**: database passwords, Vault secrets, API keys, the Vercel and GitHub environment
  variables (database URLs, `NEXTAUTH_SECRET`, Resend, Google OAuth, `CRON_SECRET`, storage keys), Supabase project
  settings (auth, network restrictions, pooler), and GitHub Actions schedules. Keep their *list* (not their values)
  current, so a recovery knows what must be re-created.
* **Writes after the dump**: the backup is a copy as of its own time.

## Disaster recovery

First decide which kind of incident it is: the response is completely different, and restoring the database is
almost never the answer to a bad deployment.

### A. A deployment broke the site (the database is fine)

Signs: errors began right after a deploy; the data is intact (row counts and the critical fingerprint match the
previous known state).

1. In Vercel, select **Instant Rollback** to the immediately previous eligible production deployment. The current
   Hobby plan restricts Instant Rollback to that deployment; an arbitrary older build or a preview is not an
   interchangeable target. Confirm compatibility with the current schema and settings before acting. Rollback
   does not restore the database or Storage and reuses the old build's configuration/environment. Vercel cron
   configuration also reverts; Supabase Cron does not. After rollback, automatic production domain assignment is
   disabled until rollback is undone. See [Vercel's current restrictions](https://vercel.com/docs/instant-rollback).
2. Confirm the site works, then fix forward in a PR. **Do not restore a backup**: it would discard every write since
   it was taken.
3. If a migration itself is at fault, use that migration's own documented rollback from `supabase/manual/` (or its
   header), reviewed and applied deliberately, never the whole backup.

### B. The database itself is damaged or lost

Signs: rows missing or corrupted, the project deleted or unrecoverable. Restoring loses every write after the backup,
so it needs the owner's explicit decision.

1. **Stop writes**: put the site in maintenance or pause the Vercel project, and disable the scheduled GitHub
   workflows, so nothing writes to a database that is about to be replaced.
2. **Restore into a new, empty Supabase project.** Never restore over the damaged project, and never into a database
   that already has these tables (`schema.sql` uses `IF NOT EXISTS` and would silently keep the damaged ones).
3. Before anything else touches it, apply the same order as step 8: revoke the default **table and function**
   privileges of `anon` and `authenticated` in `public` (the hosted project has the same defaults as the image, so
   without this the trigger functions would regain EXECUTE for both roles), load `schema.sql`, then `data.sql` without the platform-schema blocks, in one transaction
   with `ON_ERROR_STOP`. **This has only been rehearsed on a local container, not on a hosted project**: the hosted
   `postgres` role's rights (for example to set `session_replication_role`), extension versions and the pooler may
   behave differently. Rehearse it on a scratch project before it is ever needed.
4. **Verify before exposing it**, read-only, in the new project: `table-row-counts.sql` (then the verifier),
   `security-fingerprint.sql` (every line except extensions must equal the last production export: the table grantees
   must be exactly `postgres service_role`, RLS on every table, the same policies, triggers and EXECUTE grants), and
   `critical-fingerprint.sql`. Do not grant anything to `anon` or `authenticated` to "make something work": the
   application connects as `postgres` through Prisma and needs no such grant.
5. Re-create what the dump does not hold: copy the Storage files and recreate the buckets with the same policies;
   re-create secrets; update the Vercel database variables to the new project and redeploy; re-enable the workflows.
6. Record the gap: which writes after the backup were lost, and tell the affected people if it matters.

### Read-only checks to keep handy

All of these only read the catalog (run them in the SQL editor, or with `psql` as a read-only check):

* `scripts/backup/security-fingerprint.sql`: one line per category (privileges, RLS, policies, functions and their
  EXECUTE grants, triggers, constraints, indexes, schema and default privileges); compare two exports with `diff`.
* `scripts/backup/critical-fingerprint.sql`: counts and id fingerprints of the tables that matter most.
* `scripts/backup/table-row-counts.sql`: every table's exact row count.
* Which roles can read what, in detail:
  `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated');`
  (expected on production: no rows) and
  `select grantee, table_name, count(*) from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1, 2;`
  (expected: `anon` on articles, article_tags, categories, series, tags, team_members only).

## If something goes wrong

| Message | Cause and fix |
|---|---|
| `server version mismatch` / `aborting because of server version mismatch` | the CLI's `pg_dump` is older than the server (17). `brew upgrade supabase`, then retry. The script runs the CLI from an empty folder so an old project setting cannot interfere |
| `password authentication failed` | wrong password. **Do not reset it.** Re-check the `.env.local` value or ask the maintainer |
| `cannot reach host:port` / `no route to host` / timeout | direct host on an IPv4-only network: use the Session pooler string (step 4) |
| `Cannot connect to the Docker daemon` | `colima start`, then retry |
| `this connection string is for project 'X', not 'scllbuwkcqtmfogsgalt'` | wrong project: stop and check which string you pasted |
| `the output folder looks cloud-synced` / `inside a git repository` | use the encrypted volume as `--out` |
| `invalid URI query parameter` | should not happen (the script strips them); if it does, report the message to the maintainer |
| a CLI message about flags, for example `mutually exclusive` or `unknown flag` | the installed Supabase CLI changed its `db dump` options. The script prints the CLI's own message (scrubbed of the password). Do not edit flags by hand: report the message to the maintainer. After a fix, `scripts/backup/local-integration-test.sh` must pass before the scripts are used on production again |
| the verifier prints `MISMATCH` for a busy table only | normal drift: re-take counts and backup in a quiet minute |
| the verifier prints `MISMATCH` or `MISSING` for a stable table | **stop.** The backup is not good enough; note the table and ask the maintainer |

## Limits you should know about

* `supabase db dump --db-url` receives the URL as a command-line argument, so for the few seconds each dump runs it is visible to other processes of **your own user** (and root). On a personal single-user Mac that is acceptable; do not run it on a shared machine. The Supabase CLI documents no way to avoid this and no temporary-login-role mechanism, so none is claimed.
* The three dumps are separate transactions seconds apart, so the backup is not one exact snapshot if the site is being written to while it runs. That is why the counts are taken before and after and the verifier accepts a count between them. For a change that must not lose a single write (for example a bulk edit), take the backup in a quiet period.
* The environment variables `CONSILIUM_BACKUP_ALLOW_ANY_HOST` and `CONSILIUM_BACKUP_SKIP_CONNECTIVITY` exist only so the local tests can point the script at a local container. Never set them for a production backup: they switch off the "Supabase hosts only" and reachability checks.
* A backup you have not restored is still only partly proven. Step 8 is the proof; do it.
