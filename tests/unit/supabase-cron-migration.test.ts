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
    // the interval is one named setting, used by the schedule call and nowhere hard-coded in it
    expect(body).toContain("v_schedule CONSTANT TEXT := '*/5 * * * *'")
    expect(body).toContain("cron.schedule('publish-scheduled', v_schedule, 'select public.invoke_publish_scheduled()')")
    expect(body).toContain("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'publish-scheduled'")
  })

  it('applies in dependency order by filename', () => {
    expect([INFRA, ENABLE].sort()).toEqual([INFRA, ENABLE])
  })

  it('the enable migration refuses to run without its prerequisites, and never decrypts the secret', () => {
    const body = code(enable)
    for (const guard of [
      "to_regclass('cron.job') IS NULL",
      "to_regclass('public.scheduler_invocations') IS NULL",
      "to_regprocedure('public.invoke_publish_scheduled()') IS NULL",
      "to_regprocedure('public.reconcile_scheduler_invocations()') IS NULL",
      "FROM vault.secrets WHERE name = 'cron_secret'",
      "jobname = 'reconcile-scheduler-invocations'",
      "outcome = 'success'",
    ]) {
      expect(body).toContain(guard)
    }
    expect((body.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(body).not.toContain('decrypted_secrets')
    // every guard comes before anything is scheduled
    expect(body.indexOf('cron.schedule(')).toBeGreaterThan(body.lastIndexOf('RAISE EXCEPTION'))
  })
})

describe('Supabase Cron migrations: every call lands in exactly one outcome', () => {
  const body = code(infra)
  const OUTCOMES = ['pending', 'success', 'auth_failure', 'http_error', 'timeout', 'network_error', 'lost', 'not_sent', 'bad_response']

  it('the column is constrained to the documented categories', () => {
    for (const o of OUTCOMES) expect(body).toContain(`'${o}'`)
    expect(body).toMatch(/outcome\s+TEXT\s+NOT NULL DEFAULT 'pending'/)
    expect(body).toMatch(/CHECK \(outcome IN \(('[a-z_]+',?)+\)\)/)
  })

  it('the reconciler maps timeout, 2xx, 401/403, other statuses and no status separately', () => {
    const flat = body.replace(/\s+/g, ' ')
    expect(flat).toContain("WHEN COALESCE(r.timed_out, FALSE) THEN 'timeout'")
    expect(flat).toContain("WHEN r.status_code BETWEEN 200 AND 299 THEN CASE WHEN v_valid THEN 'success' ELSE 'bad_response' END")
    expect(flat).toContain("WHEN r.status_code IN (401, 403) THEN 'auth_failure'")
    expect(flat).toContain("WHEN r.status_code IS NOT NULL THEN 'http_error'")
    expect(flat).toContain("'network_error'")
    expect(flat).toContain("outcome = 'lost'")
    expect(flat).toContain("'not_sent'")
  })

  it('a 2xx only counts as success when the body is the endpoint JSON, checked without relying on AND short-circuiting', () => {
    const flat = body.replace(/\s+/g, ' ')
    expect(flat).toContain("jsonb_typeof(v_body -> 'due') = 'number'")
    expect(flat).toContain("jsonb_typeof(v_body -> 'published') = 'number'")
    // every cast of the untrusted body sits inside the IF that has already proved it is a number
    const guard = flat.indexOf("jsonb_typeof(v_body -> 'due') = 'number'")
    expect(flat.indexOf("(v_body ->> 'due')::NUMERIC")).toBeGreaterThan(guard)
  })

  it('a pg_net failure to queue is recorded (not_sent), with the secret redacted before the message is truncated', () => {
    const flat = body.replace(/\s+/g, ' ')
    expect(flat).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(flat).toContain("left(replace(SQLERRM, v_secret, '[redacted]'), 300)")
  })

  it('cron.job_run_details, which pg_cron never prunes, is trimmed to 7 days by a daily job', () => {
    const flat = body.replace(/\s+/g, ' ')
    expect(flat).toContain("cron.schedule( 'prune-cron-run-details', '23 3 * * *',")
    expect(flat).toContain("delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'")
  })

  it('retention (30 days) is enforced by both the reconciler and the publisher function', () => {
    expect((body.match(/DELETE FROM public\.scheduler_invocations WHERE invoked_at < now\(\) - interval '30 days'/g) ?? []).length).toBe(2)
  })

  it('the runbook documents every outcome', () => {
    for (const o of OUTCOMES) expect(docs).toContain(`\`${o}\``)
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
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        expect(body).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM ${role}`))
      }
    }
    expect(body).toContain('ALTER TABLE public.scheduler_invocations ENABLE ROW LEVEL SECURITY')
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(body).toMatch(new RegExp(`REVOKE ALL ON public\\.scheduler_invocations FROM ${role}`))
    }
    expect(body).not.toMatch(/GRANT\s+/i)
  })

  it('every statement is additive: nothing drops or alters existing application tables', () => {
    expect(body).not.toMatch(/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+public\.(users|articles|team_members)/i)
  })
})
