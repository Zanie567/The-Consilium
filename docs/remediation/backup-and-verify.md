# Backing up the production database on your Mac, and proving the backup is good

**Do this before any change that could damage data (a migration, a bulk edit, a clean-up job) and from time to time in between.** Supabase's Free plan takes no automatic backups, so this is the only way back if something goes wrong.
Nothing here changes production: it only reads. It costs nothing (every tool is free) and takes about 30 to 40 minutes the first time, less afterwards (steps 1 to 3 are one-off). The database was about 15 MB in October 2026; check the size of the newest backup folder before assuming the 200 MB volume in step 3 still has room.

> **The backup is full of personal data** (subscriber and user emails, password hashes, admin notes, contact messages, login IP addresses). It must be encrypted at rest, never uploaded anywhere unencrypted, never committed, and deleted when it is no longer needed (step 11).
> **The connection string is the keys to the database.** Treat it like the password it contains. Never paste it into chat, a ticket, a document or a screenshot, and never type it on a command line.

## Status

Two different things, kept apart on purpose:

* **The existing production backup of 9 October 2026.** It was created, and verified by the operator, **before this toolkit was repaired and not by these repaired scripts**. This guide does not record how it was made or where it is kept. It is the operator's record, not evidence about the scripts. Never delete or overwrite it while it is still needed: every run of `take-supabase-backup.sh` writes a new timestamped folder and never touches an existing one (and fails rather than reuse a name).
* **This toolkit.** Its evidence is the local tests below: a real backup, verification and restore of a *throwaway local database* with the real Supabase CLI. It has **not yet been run against production**, and the restore (step 8) has never been run against a real Supabase project. Either needs the operator's separate approval.

Why the repair was needed: the first version of `take-supabase-backup.sh` could not have produced a complete backup with the Supabase CLI now installed (2.120.0). It passed `--keep-comments` to the data dump, and the CLI refuses that flag together with `--data-only`; the CLI reports the refusal on standard output, which the script threw away, so the failure showed no reason. Both are fixed. Use these scripts for any further backup.

## How the scripts were tested

* **Unit tests** (`tests/unit/backup-scripts.test.ts`, Bash 3.2 as shipped with macOS): credential handling, refusals, and every way the verifier must fail. A stand-in `supabase` program now enforces the real CLI's flag rules, including that errors arrive on standard output.
* **Contract test against the installed CLI**: the same file replays the exact flags the script uses through the real `supabase db dump --dry-run` (no connection, no Docker). It fails if a CLI upgrade rejects those flags, and it is skipped if the CLI is not installed.
* **Local end-to-end test** (`scripts/backup/local-integration-test.sh`, needs Colima or Docker Desktop): starts a disposable Supabase Postgres container with TLS and a pooler-style login, runs the real CLI through `take-supabase-backup.sh`, runs the verifier, restores into a second disposable container exactly as step 8 does, verifies against the restored counts, and confirms the verifier rejects a mismatch. Last run: Supabase CLI 2.120.0, image `supabase/postgres:17.11.0.004`, all checks passed. It never contacts production and removes only the containers it created. **Run it again after upgrading the Supabase CLI.**

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

## 8. Strongest check: restore it into a throwaway database (recommended)

This proves the backup can actually be loaded. It uses a disposable container on your Mac that never touches production. These exact commands were rehearsed against a real backup of a local throwaway database with Supabase CLI 2.120.0 and `supabase/postgres:17.11.0.004` (see "How the scripts were tested"). If it fails on your Mac for an environment reason such as a missing role or extension, that is **not** by itself proof the backup is bad; the checks in step 7 still stand. Note the first error line and ask the maintainer.

Run it from `~/consilium-backup-tools` in the same terminal window as steps 5 to 7 (it uses `$C`). If an earlier attempt left its container behind, remove that one container first with `docker rm -f consilium-restore-check`.

```bash
B=/Volumes/ConsiliumBackup/consilium-prod-<timestamp>
IMG=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'supabase/postgres' | head -1); echo "$IMG"
docker run -d --name consilium-restore-check -e POSTGRES_PASSWORD=throwaway-local-only "$IMG"
until docker exec consilium-restore-check pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

( cat "$B/schema.sql"; echo "SET session_replication_role = replica;"; cat "$B/data.sql" ) \
  | docker exec -i consilium-restore-check psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction

docker exec -i consilium-restore-check psql -U postgres -d postgres --csv < scripts/backup/table-row-counts.sql > "$C/restored.csv"
scripts/backup/verify-supabase-backup.sh "$B" --counts-before "$C/restored.csv" | tee "$C/verify-restored-output.txt"
docker rm -f consilium-restore-check
```

The last verifier run compares the backup's rows with the **restored** copy's counts, which must match exactly; `RESULT: VERIFIED` there means every row loaded.

How it works, so a failure is easy to read: `schema.sql` creates the tables, `SET session_replication_role = replica` stops triggers and foreign-key checks firing while rows load, `data.sql` loads every row with `COPY`, and `ON_ERROR_STOP` plus `--single-transaction` mean any error rolls everything back instead of leaving a half-restored database. The container is a Supabase Postgres image, which already has the roles (`anon`, `authenticated`, `service_role`, ...) and the `auth` and `storage` schemas that the dump refers to; a plain Postgres image would fail on those. `roles.sql` is not loaded here: it is kept as a record of the cluster roles.

### Restoring for real (disaster recovery)

**Never run a restore against production without separate, explicit approval**, and never into a database that already has these tables: `schema.sql` is written with `IF NOT EXISTS`, so it would skip the existing tables and `data.sql` would then collide with their rows (the single transaction rolls that back, but nothing is restored).
What has and has not been proven: loading `schema.sql` then `data.sql` with `ON_ERROR_STOP` into a **local Supabase Postgres container** is rehearsed (above). Loading them into a **real hosted Supabase project** is **not**: nothing here has been tried against one, so hosted-specific differences (for example the privileges of the `postgres` role, extensions, `session_replication_role`) are unknown. The intended shape, to be rehearsed on a scratch project before it is ever needed:

1. Create a **new, empty** Supabase project. Do not restore over the damaged one.
2. Load `schema.sql`, then `SET session_replication_role = replica;`, then `data.sql`, in one transaction with `ON_ERROR_STOP`, using `psql` against the new project's Session pooler. Give the host, user and database as separate arguments and let `psql` ask for the password (hidden), so the password is never on a command line or in shell history. The exact command is deliberately not given here because it has not been tested.
3. Run `scripts/backup/table-row-counts.sql` in the new project's SQL editor and verify the backup against that export (the last command of step 8).
4. Only then point Vercel's database variables at the new project and redeploy. Storage files (images) are not in this backup and must be restored separately.

## 9. Keep a second, verified copy

Only after step 7 (and ideally step 8) passed on the primary: eject the volume (`diskutil eject /Volumes/ConsiliumBackup`), then copy the **encrypted** bundle to a different physical drive (an external disk; not a cloud folder):

```bash
cp -R ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/
diff -r ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/ConsiliumBackup.sparsebundle && echo "copy is identical"
```

For a later backup this copies over the previous second copy. Do that only once the new backup is verified, and if you can, alternate between two external drives so one good copy always survives a bad copy run.

## 10. Record the result (with no secrets)

Keep `verify-output.txt`, `verify-restored-output.txt` and the backup's `MANIFEST.txt` with the backup (they are in `$C` and the backup folder). They contain a folder name and row counts, nothing secret, and are what you would show a reviewer. If someone cross-checks the numbers, they can run `scripts/backup/table-row-counts.sql` read-only against production and compare. **Never share the connection string, the password, or any part of a dump file.**

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

Covered: every table and row in the database's `public` schema (the whole application: users, articles, subscribers, comments, audit log, and so on), its structure, policies and functions, and the cluster roles (no passwords).
Partly covered, **Supabase Auth**: the CLI's data dump skips only its own internal exclusion list, so `data.sql` can also carry rows of tables in the `auth` schema (in the local test it held four `auth` blocks and none from `storage`; production may differ, so check with `grep -c '^COPY "auth"' data.sql`). But `schema.sql` defines none of those tables and the verifier does not count them. They load only into a Supabase Postgres that already has the `auth` schema, as in step 8. The site signs users in with its own `users` table (not Supabase Auth), so the application does not depend on them, but do not rely on this backup as a complete copy of Supabase Auth.
Not covered: **Storage files** (article images and avatars are objects in Supabase Storage, which a database dump does not include; back them up separately if they matter), Vault secrets, and Vercel and GitHub secrets.

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
