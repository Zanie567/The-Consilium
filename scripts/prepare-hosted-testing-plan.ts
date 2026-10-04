/** Operator-only plan generator. No connections, no writes to any database, no dotenv. */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { HOSTED_TEST_WORKSPACE as w } from '../src/lib/hostedTestingWorkspace'

async function main() {
  if (process.env.TEST_HARNESS === '1' || process.env.TEST_DATABASE_URL || process.env.E2E_ISOLATED === '1') throw new Error('Hosted provisioning is separate from the automated test harness.')
  if (process.env.HOSTED_TEST_PROJECT_REF !== w.projectRef) throw new Error('Select the independently verified test project explicitly.')
  const secretFile = process.env.HOSTED_TEST_SECRETS_FILE
  const output = process.env.HOSTED_TEST_PLAN_DIRECTORY
  if (!secretFile || !output || !path.isAbsolute(secretFile) || !path.isAbsolute(output)) throw new Error('Absolute operator secret/plan paths are required.')
  const secrets = JSON.parse(fs.readFileSync(secretFile, 'utf8')) as Record<string, string>
  if (!secrets.SUPABASE_SERVICE_ROLE_KEY?.startsWith('sb_secret_')) throw new Error('Supply this test project’s server storage key through the protected operator file.')
  secrets.databasePassword ??= randomBytes(24).toString('base64url')
  secrets.fixturePassword ??= randomBytes(24).toString('base64url')
  secrets.NEXTAUTH_SECRET ??= randomBytes(48).toString('base64url')
  secrets.CRON_SECRET ??= randomBytes(32).toString('base64url')
  const salt = randomBytes(16)
  const salted = pbkdf2Sync(secrets.databasePassword, salt, 4096, 32, 'sha256')
  const client = createHmac('sha256', salted).update('Client Key').digest()
  const server = createHmac('sha256', salted).update('Server Key').digest('base64')
  const verifier = `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(client).digest('base64')}:${server}`
  const hash = await bcrypt.hash(secrets.fixturePassword, 12)
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const id = (key: string) => `hosted-test-${w.projectRef}-${key}`
  const personas = [
    ['admin', 'Testing Administrator', 'ADMIN', null], ['writer', 'Test Writer', 'WRITER', 'writer'],
    ['writer-other', 'Other Writer', 'WRITER', 'writer-other'], ['editor', 'Opinion Editor', 'EDITOR', 'editor'],
    ['editor-global', 'Global Editor', 'EDITOR', 'editor-global'], ['growth', 'Test Growth', 'GROWTH', 'growth'],
  ] as const
  const accounts = personas.map(([key, name, role, persona]) => `(${quote(id(key))},${quote(`${key}@consilium.test`)},${quote(name)},${quote(role)},${persona ? quote(persona) : 'NULL'},${quote(hash)},now(),now())`).join(',\n')
  const ownershipChecks = personas.map(([key, , role, persona]) => `IF EXISTS (SELECT 1 FROM users WHERE (email=${quote(`${key}@consilium.test`)} OR id=${quote(id(key))} OR ${persona ? `"testPersonaKey"=${quote(persona)}` : 'false'}) AND (id<>${quote(id(key))} OR email<>${quote(`${key}@consilium.test`)} OR role<>${quote(role)} OR "testPersonaKey" IS DISTINCT FROM ${persona ? quote(persona) : 'NULL'})) THEN RAISE EXCEPTION 'Hosted fixture conflict: ${key}'; END IF;`).join('\n')
  const body = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A dedicated test article for ownership and assignment checks.' }] }] })
  const plan = `BEGIN;
SELECT pg_advisory_xact_lock(677201032);
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM site_settings WHERE key='testing-workspace' AND value IS DISTINCT FROM ${quote(w.workspaceId)}) THEN RAISE EXCEPTION 'Workspace conflict'; END IF;
 IF EXISTS (SELECT 1 FROM site_settings WHERE key='testing-hosted-project' AND value IS DISTINCT FROM ${quote(JSON.stringify(w))}) THEN RAISE EXCEPTION 'Hosted project attestation conflict'; END IF;
 IF NOT EXISTS (SELECT 1 FROM site_settings WHERE key='testing-workspace') AND EXISTS (SELECT 1 FROM users) THEN RAISE EXCEPTION 'Refusing to attest a populated unverified database'; END IF;
 ${ownershipChecks}
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${quote(w.databaseRole)}) THEN CREATE ROLE ${w.databaseRole} LOGIN PASSWORD ${quote(verifier)}; END IF;
END $guard$;
GRANT USAGE ON SCHEMA public, storage TO ${w.databaseRole};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${w.databaseRole};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${w.databaseRole};
GRANT SELECT ON storage.buckets TO ${w.databaseRole};
DO $policies$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename AND policyname='consilium_testing_server') THEN
   EXECUTE format('CREATE POLICY consilium_testing_server ON public.%I FOR ALL TO ${w.databaseRole} USING (true) WITH CHECK (true)',t.tablename);
  END IF;
 END LOOP;
END $policies$;
CREATE TABLE IF NOT EXISTS public.testing_email_outbox (id text PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, html text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.testing_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.testing_email_outbox FROM anon,authenticated;
GRANT SELECT,INSERT ON public.testing_email_outbox TO ${w.databaseRole};
DO $sink$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='testing_email_outbox' AND policyname='consilium_testing_server') THEN CREATE POLICY consilium_testing_server ON public.testing_email_outbox FOR ALL TO ${w.databaseRole} USING(true) WITH CHECK(true); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='buckets' AND policyname='consilium_testing_readiness') THEN CREATE POLICY consilium_testing_readiness ON storage.buckets FOR SELECT TO ${w.databaseRole} USING(true); END IF;
END $sink$;
INSERT INTO users (id,email,name,role,"testPersonaKey",password,"emailVerified","updatedAt") VALUES ${accounts} ON CONFLICT(id) DO NOTHING;
INSERT INTO categories (id,name,slug) VALUES (${quote(id('opinion'))},'Opinion','opinion'),(${quote(id('economics'))},'Economics','economics') ON CONFLICT(id) DO NOTHING;
INSERT INTO category_editors (id,"userId","categoryId") VALUES (${quote(id('opinion-assignment'))},${quote(id('editor'))},${quote(id('opinion'))}) ON CONFLICT(id) DO NOTHING;
INSERT INTO team_members (id,name,role,email,"userId","order","isActive",bio) VALUES (${quote(id('chief-card'))},'Testing Administrator','Editor-in-Chief','admin@consilium.test',${quote(id('admin'))},1,true,'Explicit public appointment on the isolated test site.') ON CONFLICT(id) DO NOTHING;
INSERT INTO articles (id,title,slug,content,"authorId","categoryId",status,"updatedAt") VALUES
 (${quote(id('assigned-article'))},'Hosted fixture: assigned Opinion review','hosted-fixture-assigned-review',${quote(body)},${quote(id('writer'))},${quote(id('opinion'))},'PENDING_REVIEW',now()),
 (${quote(id('unassigned-article'))},'Hosted fixture: other writer and unassigned category','hosted-fixture-unassigned-review',${quote(body)},${quote(id('writer-other'))},${quote(id('economics'))},'PENDING_REVIEW',now()) ON CONFLICT(id) DO NOTHING;
INSERT INTO site_settings (key,value) VALUES ('testing-workspace',${quote(w.workspaceId)}),('testing-hosted-project',${quote(JSON.stringify(w))}) ON CONFLICT(key) DO NOTHING;
COMMIT;
`
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  fs.writeFileSync(secretFile, JSON.stringify(secrets, null, 2)+'\n', { mode: 0o600 }); fs.chmodSync(secretFile, 0o600)
  fs.writeFileSync(path.join(output, 'fixtures-and-access.sql'), plan, { mode: 0o600 })
  const database = `postgresql://${w.databaseRole}.${w.projectRef}:${encodeURIComponent(secrets.databasePassword)}@${w.poolerHost}:6543/postgres?sslmode=verify-full`
  const env = {
    DATABASE_URL: database, DIRECT_URL: database, NEXTAUTH_SECRET: secrets.NEXTAUTH_SECRET, CRON_SECRET: secrets.CRON_SECRET,
    NEXTAUTH_URL: w.siteOrigin, NEXT_PUBLIC_SITE_URL: w.siteOrigin, SITE_URL: w.siteOrigin,
    NEXT_PUBLIC_SUPABASE_URL: w.storageOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.publishableKey ?? '', SUPABASE_SERVICE_ROLE_KEY: secrets.SUPABASE_SERVICE_ROLE_KEY,
    TESTING_MODE_ENABLED: '1', TESTING_WORKSPACE_KIND: 'hosted', TESTING_WORKSPACE_ID: w.workspaceId, EMAIL_TRANSPORT: 'capture-db', OUTBOUND_INTEGRATIONS_DISABLED: '1',
    RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FRED_API_KEY: '', ALPHA_VANTAGE_API_KEY: '', ADMIN_EMAILS: 'admin@consilium.test',
  }
  fs.writeFileSync(path.join(output, 'environment.private.json'), JSON.stringify(env, null, 2)+'\n', { mode: 0o600 })
  console.log(`Prepared operator plan for verified project ${w.projectRef}. No database connected or changed. Secrets remain in protected files; existing account passwords/appointments are never reset.`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
