# Backing up the production database on your Mac, and proving the backup is good

**Do this before any migration is applied.** Supabase's Free plan takes no automatic backups, so this is the only way back if something goes wrong.
Nothing here changes production: it only reads. It costs nothing (every tool is free), takes about 30 to 40 minutes the first time, and the database is 15 MB.

> **The backup is full of personal data** (subscriber and user emails, password hashes, admin notes, contact messages, login IP addresses). It must be encrypted at rest, never uploaded anywhere unencrypted, never committed, and deleted when it is no longer needed (step 11).
> **The connection string is the keys to the database.** Treat it like the password it contains. Never paste it into chat, a ticket, a document or a screenshot, and never type it on a command line.

## Status

* **A production backup was successfully created on 9 October 2026.** This guide does not record where it is, how it was made, or whether it has been through the step 7 verifier and the step 8 restore test; those are for the operator to confirm and keep with the backup (step 10). Do not overwrite it: every run of `take-supabase-backup.sh` writes a new timestamped folder and never touches an existing one.
* **The first version of the scripts could not have produced a complete backup with the Supabase CLI now installed (2.120.0).** It passed `--keep-comments` to the data dump, and the CLI refuses that flag together with `--data-only`; the CLI reports the refusal on standard output, which the script threw away, so the failure showed no reason. Both are fixed (see "How the scripts were tested"). Use this version of the scripts for any further backup.
* **Not yet done:** the repaired scripts have not been run against production, and the restore (step 8) has only been rehearsed on a local throwaway database, never on a real Supabase project. Either needs the operator's separate approval.

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
git clone --depth 1 --branch docs/backup-runbook --single-branch https://github.com/Zanie567/The-Consilium.git ~/consilium-backup-tools
cd ~/consilium-backup-tools
```

The scripts are short (`scripts/backup/`); read `take-supabase-backup.sh` and `verify-supabase-backup.sh` before you run them. Neither contacts anything except the database (the first) and nothing at all (the second).

## 3. Make an encrypted place for the backup

```bash
diskutil image create blank --encrypt --format UDSB --size 200m --volumeName ConsiliumBackup --fs APFS ~/ConsiliumBackup.sparsebundle
```

It asks for a passphrase twice (typing is hidden). Put the passphrase in your password manager; **if you lose it the backup is unrecoverable by design**. Then open it:

```bash
diskutil image attach ~/ConsiliumBackup.sparsebundle      # asks for the passphrase; it mounts at /Volumes/ConsiliumBackup
mkdir -p /Volumes/ConsiliumBackup/counts
```

If a macOS dialog offers to remember the passphrase in your keychain, **untick it**. (`~/ConsiliumBackup.sparsebundle` lives in your home folder, not in Desktop or Documents, so iCloud does not sync it.) FileVault is already on for this Mac.

## 4. Find the connection string without revealing the password

The password you need is the one the live site already uses. **Do not reset the database password**: the live site's connection string contains it, so a reset would take the site down until Vercel is updated.
Your main checkout's `.env.local` already holds it. This command shows only the variable name, user, host and port; the password is never printed:

```bash
sed -nE "s#^(DIRECT_URL|DATABASE_URL)=[\"']?postgres(ql)?://([^:]+):[^@]*@([^:/]+):([0-9]+)/.*#\1  user=\3  host=\4  port=\5#p" /Users/zanie/The-Consilium/.env.local
```

Read the result:

| You see | Meaning | Do this |
|---|---|---|
| `host=aws-0-….pooler.supabase.com  port=5432` | session pooler: ideal | use that variable |
| `host=aws-0-….pooler.supabase.com  port=6543` | transaction pooler | fine: the script switches it to 5432 itself (pg_dump cannot use 6543) |
| `host=db.scllbuwkcqtmfogsgalt.supabase.co  port=5432` | direct host, **IPv6 only on the Free plan** | try it; if the script says it cannot reach the host, your network is IPv4-only: you need the session pooler string |
| nothing printed, or the variable is missing | the file has no such line | see below |

If you need the session pooler string: Supabase Dashboard > **Connect** > **Session pooler** shows it with a `[YOUR-PASSWORD]` placeholder; the password is the one already in your `.env.local` (percent-encode special characters such as `@` as `%40`).
If you do not have the password anywhere, **stop and tell me**: obtaining it means resetting it, which is a production change that must be coordinated with a Vercel update and a redeploy, and needs your explicit approval.

The script then protects the string for you: it reads it silently (or from the file, without printing), refuses any project other than `scllbuwkcqtmfogsgalt`, refuses any host that is not Supabase, strips Prisma-only query parameters such as `?pgbouncer=true` (which `pg_dump` rejects), forces TLS, and never writes it anywhere.

## 5. Capture the live row counts BEFORE

Supabase Dashboard > **SQL Editor** > new query. Paste the contents of `scripts/backup/table-row-counts.sql` (one read-only `SELECT`), click **Run**, then use **Export** > **CSV** and save the file as:

```
/Volumes/ConsiliumBackup/counts/before.csv
```

It lists each table and its exact row count: names and numbers only, no personal data.

## 6. Take the backup

From `~/consilium-backup-tools`:

```bash
scripts/backup/take-supabase-backup.sh --out /Volumes/ConsiliumBackup --url-from-env-file /Users/zanie/The-Consilium/.env.local --var DIRECT_URL
```

(Use whichever variable step 4 showed is best; or leave off the last two options and paste the string at the hidden prompt.)
You should see, in order: the CLI version, `Target: user=… host=… port=… (password hidden, TLS required)`, then `-> schema`, `-> data`, `-> roles`, and finally `Backup written to: /Volumes/ConsiliumBackup/consilium-prod-<timestamp>`. It takes one to three minutes. It creates, owner-only: `schema.sql`, `data.sql`, `roles.sql`, `MANIFEST.sha256`, `MANIFEST.txt`, `backup.log`.
It says "NOT yet trustworthy" on purpose: the next steps decide that.

**Immediately afterwards**, repeat step 5 and save the export as `/Volumes/ConsiliumBackup/counts/after.csv`. (Rows written while the dump ran are why there is a before and an after.)

If it fails, nothing is verified. The message names the likely cause; the common ones are in the table at the end.

## 7. Verify the files and the row counts

```bash
scripts/backup/verify-supabase-backup.sh /Volumes/ConsiliumBackup/consilium-prod-<timestamp> \
  --counts-before /Volumes/ConsiliumBackup/counts/before.csv \
  --counts-after  /Volumes/ConsiliumBackup/counts/after.csv
```

It must end with **`RESULT: VERIFIED`**. It checks that: all five files exist and are owner-only; the SHA-256 of each matches the manifest; `schema.sql` and `data.sql` end with `pg_dump`'s completion marker (not cut short); no file contains a connection string or a role password; `schema.sql` defines all 37 production tables and `data.sql` has a data block for each; and, for every table, the number of rows **actually inside the backup** lies between the live counts you took before and after.
Any `FAIL` ends with `NOT VERIFIED`, exit status 1: **do not continue.** A `MISMATCH` row names the table; a busy table can drift (re-take both counts and the backup in a quiet minute), but a table like `users` or `subscribers` that differs means rows are missing or extra and must be understood first.

## 8. Strongest check: restore it into a throwaway database (recommended)

This proves the backup can actually be loaded. It uses a disposable container on your Mac that never touches production. These exact commands were rehearsed against a real backup of a local throwaway database with Supabase CLI 2.120.0 and `supabase/postgres:17.11.0.004` (see "How the scripts were tested"). If it fails on your Mac for an environment reason such as a missing role or extension, that is **not** by itself proof the backup is bad; the checks in step 7 still stand. Send me the first error line.

```bash
B=/Volumes/ConsiliumBackup/consilium-prod-<timestamp>
IMG=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'supabase/postgres' | head -1); echo "$IMG"
docker run -d --name consilium-restore-check -e POSTGRES_PASSWORD=throwaway-local-only "$IMG"
until docker exec consilium-restore-check pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

( cat "$B/schema.sql"; echo "SET session_replication_role = replica;"; cat "$B/data.sql" ) \
  | docker exec -i consilium-restore-check psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction

docker exec -i consilium-restore-check psql -U postgres -d postgres --csv < scripts/backup/table-row-counts.sql > /Volumes/ConsiliumBackup/counts/restored.csv
scripts/backup/verify-supabase-backup.sh "$B" --counts-before /Volumes/ConsiliumBackup/counts/restored.csv
docker rm -f consilium-restore-check
```

The last verifier run compares the backup's rows with the **restored** copy's counts, which must match exactly; `RESULT: VERIFIED` there means every row loaded.

How it works, so a failure is easy to read: `schema.sql` creates the tables, `SET session_replication_role = replica` stops triggers and foreign-key checks firing while rows load, `data.sql` loads every row with `COPY`, and `ON_ERROR_STOP` plus `--single-transaction` mean any error rolls everything back instead of leaving a half-restored database. The container is a Supabase Postgres image, which already has the roles (`anon`, `authenticated`, `service_role`, ...) and the `auth` and `storage` schemas that the dump refers to; a plain Postgres image would fail on those. `roles.sql` is not loaded here: it is kept as a record of the cluster roles.

### Restoring for real (disaster recovery)

**Never run a restore against production without separate, explicit approval**, and never into a database that already has these tables: `schema.sql` is written with `IF NOT EXISTS`, so it would skip the existing tables and `data.sql` would then collide with their rows (the single transaction rolls that back, but nothing is restored).
The safe shape, which has **not** been rehearsed against a real Supabase project (only the local container above):

1. Create a **new, empty** Supabase project (or a branch). Do not restore over the damaged one.
2. Run the step 8 command with `psql` pointed at the new project's Session pooler string instead of `docker exec`, typing the connection string at a hidden prompt as in step 4, never on the command line or in shell history.
3. Run `scripts/backup/table-row-counts.sql` in the new project's SQL editor and verify the backup against that export (the last command of step 8).
4. Only then point Vercel's database variables at the new project and redeploy. Storage files (images) must be restored separately: they are not in this backup.

## 9. Keep a second, verified copy

Eject the volume (`diskutil eject /Volumes/ConsiliumBackup`), then copy the **encrypted** bundle to a different physical drive (an external disk; not a cloud folder):

```bash
cp -R ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/
diff -r ~/ConsiliumBackup.sparsebundle /Volumes/<your-external-drive>/ConsiliumBackup.sparsebundle && echo "copy is identical"
```

## 10. Tell me it is done (with no secrets)

Send me only: the full output of the step 7 verifier (it contains a folder name and row counts, nothing secret), the contents of `MANIFEST.txt`, and whether step 8 passed.
I will then run the same row-count query read-only against production and cross-check it against your numbers. **Never send me the connection string, the password, or any part of a dump file.**

## 11. Tidy up, and how long to keep it

```bash
fc -l 1 | grep -cE 'postgres(ql)?://[^ ]*:[^ ]*@' || true   # expect 0: no connection string should be in your shell history
colima stop                                  # optional
diskutil eject /Volumes/ConsiliumBackup
```

Keep the backup until the migrations are applied, verified, and have run cleanly for about 30 days, then delete it (`rm -rf ~/ConsiliumBackup.sparsebundle`, and the external copy): it holds personal data, so keep it no longer than the safety it provides is needed.

---

## What this backup does and does not cover

Covered: every table and row in the database's `public` schema (the whole application: users, articles, subscribers, comments, audit log, and so on), its structure, policies and functions, and the cluster roles (no passwords).
Partly covered: `data.sql` also carries the rows of tables in Supabase's own `auth` schema (the CLI's data dump includes every schema except its internal exclusion list), but `schema.sql` defines none of those tables, and the verifier does not count them. They restore only into a Supabase Postgres that already has the schema, as in step 8. The site uses its own `users` table, not Supabase Auth, so nothing the application needs lives there.
Not covered: **Storage files** (article images and avatars live in Supabase Storage, which a database dump does not include), Vault secrets, and Vercel and GitHub secrets. None of those is touched by the migrations.

## If something goes wrong

| Message | Cause and fix |
|---|---|
| `server version mismatch` / `aborting because of server version mismatch` | the CLI's `pg_dump` is older than the server (17). `brew upgrade supabase`, then retry. The script runs the CLI from an empty folder so an old project setting cannot interfere |
| `password authentication failed` | wrong password. **Do not reset it.** Re-check the `.env.local` value or tell me |
| `cannot reach host:port` / `no route to host` / timeout | direct host on an IPv4-only network: use the Session pooler string (step 4) |
| `Cannot connect to the Docker daemon` | `colima start`, then retry |
| `this connection string is for project 'X', not 'scllbuwkcqtmfogsgalt'` | wrong project: stop and check which string you pasted |
| `the output folder looks cloud-synced` / `inside a git repository` | use the encrypted volume as `--out` |
| `invalid URI query parameter` | should not happen (the script strips them); if it does, send me the message |
| a CLI message about flags, for example `mutually exclusive` or `unknown flag` | the installed Supabase CLI changed its `db dump` options. The script prints the CLI's own message (scrubbed of the password). Do not edit flags by hand: send me the message. After a fix, `scripts/backup/local-integration-test.sh` must pass before the scripts are used on production again |
| the verifier prints `MISMATCH` for a busy table only | normal drift: re-take counts and backup in a quiet minute |
| the verifier prints `MISMATCH` or `MISSING` for a stable table | **stop.** The backup is not good enough; send me the table |

## Limits you should know about

* `supabase db dump --db-url` receives the URL as a command-line argument, so for the few seconds each dump runs it is visible to other processes of **your own user** (and root). On a personal single-user Mac that is acceptable; do not run it on a shared machine. The Supabase CLI documents no way to avoid this and no temporary-login-role mechanism, so none is claimed.
* The three dumps are separate transactions seconds apart. The migrations modify no existing row, so this does not matter here, and it is why the counts are taken before and after.
* A backup you have not restored is still only partly proven. Step 8 is the proof; do it.
