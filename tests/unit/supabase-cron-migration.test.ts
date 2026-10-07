import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')

const INFRA = '20261007120000_scheduler_cron_infrastructure.sql'
const ENABLE = '20261007120100_scheduler_cron_enable_publish.sql'
const infra = read(INFRA)
const enable = read(ENABLE)
const docs = readFileSync(join(process.cwd(), 'docs', 'scheduler-supabase-cron.md'), 'utf8')

/** SQL with `--` comments removed, so assertions are about executable statements only. */
const code = (sql: string) => sql.replace(/--.*$/gm, '')

describe('Supabase Cron migrations: secrets', () => {
  it.each([INFRA, ENABLE])('%s contains no literal secret or bearer token', (file) => {
    const sql = read(file)
    expect(sql).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/)
    expect(sql).not.toMatch(/[A-Fa-f0-9]{32,}/)
    expect(sql).not.toMatch(/vault\.create_secret\s*\(/)
  })

  it('reads the secret from Vault at call time, and never logs it', () => {
    const body = code(infra)
    expect(body).toContain('vault.decrypted_secrets')
    expect(body).toContain("name = 'cron_secret'")
    for (const line of body.split('\n')) {
      if (/\b(RAISE|NOTICE|WARNING)\b/.test(line)) expect(line).not.toContain('v_secret')
    }
  })

  it('docs never tell the operator to query decrypted secrets or paste the value into SQL', () => {
    expect(docs).toContain('Never select from `vault.decrypted_secrets`')
    expect(docs).not.toMatch(/select[^;]*from vault\.decrypted_secrets/i)
  })
})

describe('Supabase Cron migrations: target and schedule', () => {
  it('calls the canonical www production endpoint', () => {
    expect(infra).toContain("'https://www.theconsilium.co.uk/api/publish-scheduled'")
    expect(infra).not.toMatch(/https:\/\/theconsilium\.co\.uk/) // the apex 307-redirects
  })

  it('the infrastructure migration never schedules the publisher', () => {
    expect(code(infra)).not.toMatch(/cron\.schedule\(\s*'publish-scheduled'/)
    expect(code(infra)).toContain("cron.schedule('reconcile-scheduler-invocations'")
  })

  it('the enable migration schedules the publisher every 5 minutes, idempotently', () => {
    const body = code(enable)
    expect(body).toContain("cron.schedule('publish-scheduled', '*/5 * * * *', 'select public.invoke_publish_scheduled()')")
    expect(body).toContain("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publish-scheduled'")
  })

  it('applies in dependency order by filename', () => {
    expect([INFRA, ENABLE].sort()).toEqual([INFRA, ENABLE])
  })
})

describe('Supabase Cron migrations: least privilege', () => {
  const body = code(infra)

  it('both functions are SECURITY DEFINER with an empty search_path', () => {
    expect((body.match(/SECURITY DEFINER/g) ?? []).length).toBe(2)
    expect((body.match(/SET search_path = ''/g) ?? []).length).toBe(2)
  })

  it('no API role can execute them or touch the log table', () => {
    for (const fn of ['invoke_publish_scheduled', 'reconcile_scheduler_invocations']) {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        expect(body).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM ${role}`))
      }
    }
    expect(body).toContain('ALTER TABLE public.scheduler_invocations ENABLE ROW LEVEL SECURITY')
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(body).toMatch(new RegExp(`REVOKE ALL ON public\\.scheduler_invocations FROM ${role}`))
    }
    expect(body).not.toMatch(/GRANT\s+/i)
  })

  it('every statement is additive: nothing drops or alters existing application tables', () => {
    expect(body).not.toMatch(/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+public\.(users|articles|team_members)/i)
  })
})
