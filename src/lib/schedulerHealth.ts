/**
 * Independent health check for scheduled publishing.
 *
 * "Independent" means it does not run on the thing it watches: it is called by a GitHub Actions
 * workflow, talks to the Vercel app, and reads the application database. It works whichever scheduler
 * (GitHub Actions or Supabase Cron) is publishing, and it keeps working if Supabase Cron has died.
 *
 * It looks for four problems, plus one about itself:
 *   articles_overdue   a SCHEDULED article is more than 15 minutes past its time. This is the outcome
 *                      that matters and the backstop for every other failure, whatever the cause.
 *   scheduler_stopped  the Supabase publisher job is active but has made no call for 15 minutes.
 *   requests_failing   the last 3 completed scheduler calls all failed (a failed or missing HTTP request).
 *   repeated_warnings  two or more runs in 24 hours published with non-fatal warnings.
 *   monitoring_blind   the scheduler records exist but cannot be read, so the checks above are blind.
 *
 * The output goes to a PUBLIC repository's Actions logs. Every detail is therefore a count or an age
 * and never an article title, id, URL, header, response body or secret.
 *
 * Alerts are de-duplicated in the database: one alert per NEW set of problems, a reminder every 24
 * hours while they persist, and a recovery record. A long outage is one email, not one per run.
 */

export const THRESHOLDS = {
  /** A scheduled article is "overdue" this long after its time. Three missed 5-minute ticks. */
  overdueGraceMinutes: 15,
  /** The active Supabase job is "stopped" after this long without a call. Must exceed twice the interval. */
  staleMinutes: 15,
  /** Consecutive failed calls that make `requests_failing`. */
  failureStreak: 3,
  /** Runs with warnings, within the window, that make `repeated_warnings`. */
  warningRuns: 2,
  warningWindowHours: 24,
  /** While a problem persists, remind (alert again) after this long. */
  reminderHours: 24,
  /** Alert-state rows older than this are deleted when a new one is written. */
  stateRetentionDays: 30,
} as const

export type ProblemKey = 'articles_overdue' | 'scheduler_stopped' | 'requests_failing' | 'repeated_warnings' | 'monitoring_blind'

export interface Problem {
  key: ProblemKey
  /** Counts and ages only: this is printed into a public repository's logs. */
  detail: string
}

export interface Invocation {
  outcome: string
  invokedAt: Date
  warningCount: number | null
}

/**
 * - not_installed: the Supabase migrations are not applied (GitHub is the publisher)
 * - not_scheduled: infrastructure applied, publisher not yet scheduled (mid-activation)
 * - job_inactive:  the publisher job exists but is switched off (a rollback)
 * - active:        the publisher job is on, so it is expected to keep calling
 * - unreadable:    the records exist but this connection cannot read them
 */
export type SupabaseState = 'not_installed' | 'not_scheduled' | 'job_inactive' | 'active' | 'unreadable'

export interface Snapshot {
  now: Date
  overdue: { count: number; oldestScheduledAt: Date | null }
  supabase: {
    state: SupabaseState
    lastInvokedAt: Date | null
    /** Completed (not pending) calls, newest first, up to 12. */
    recent: Invocation[]
    warningRuns24h: number
  }
}

const minutesBetween = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / 60_000)

export function evaluateHealth(s: Snapshot): Problem[] {
  const problems: Problem[] = []

  if (s.overdue.count > 0) {
    const age = s.overdue.oldestScheduledAt ? minutesBetween(s.now, s.overdue.oldestScheduledAt) : 0
    const subject = s.overdue.count === 1 ? '1 scheduled article is' : `${s.overdue.count} scheduled articles are`
    problems.push({ key: 'articles_overdue', detail: `${subject} overdue; the oldest by ${age} minutes` })
  }

  if (s.supabase.state === 'active') {
    const { lastInvokedAt, recent, warningRuns24h } = s.supabase

    if (lastInvokedAt === null) {
      problems.push({ key: 'scheduler_stopped', detail: 'the scheduler job is active but has recorded no calls' })
    } else if (minutesBetween(s.now, lastInvokedAt) > THRESHOLDS.staleMinutes) {
      problems.push({ key: 'scheduler_stopped', detail: `the last scheduler call was ${minutesBetween(s.now, lastInvokedAt)} minutes ago` })
    }

    let streak = 0
    while (streak < recent.length && recent[streak].outcome !== 'success') streak += 1
    if (streak >= THRESHOLDS.failureStreak) {
      problems.push({ key: 'requests_failing', detail: `the last ${streak} scheduler calls all failed (latest: ${recent[0].outcome})` })
    }

    if (warningRuns24h >= THRESHOLDS.warningRuns) {
      problems.push({
        key: 'repeated_warnings',
        detail: `${warningRuns24h} publishing runs had warnings in the last ${THRESHOLDS.warningWindowHours} hours`,
      })
    }
  }

  if (s.supabase.state === 'unreadable') {
    problems.push({ key: 'monitoring_blind', detail: 'the scheduler records could not be read, so Supabase Cron failures would go unnoticed' })
  }

  return problems
}

/**
 * The few database calls this module makes, as a minimal structural type. It is deliberately NOT
 * `Pick<PrismaClient, ...>`: the app's shared client is configured with `omit: { user: { password } }`,
 * which makes its type incompatible with the plain generated client (that mismatch broke `tsc`).
 * Both the app's client and a plain test client satisfy this.
 */
interface Db {
  article: {
    aggregate(args: {
      where: { status: 'SCHEDULED'; deletedAt: null; scheduledAt: { lt: Date } }
      _count: { _all: true }
      _min: { scheduledAt: true }
    }): Promise<{ _count: { _all: number }; _min: { scheduledAt: Date | null } }>
  }
  auditLog: {
    findFirst(args: {
      where: { action: { in: string[] } }
      orderBy: ({ createdAt: 'desc' } | { id: 'desc' })[]
      select: { action: true; createdAt: true; metadata: true }
    }): Promise<{ action: string; createdAt: Date; metadata: unknown } | null>
    create(args: { data: { action: string; targetId: string; targetType: string; performedBy: string; metadata: Record<string, string> } }): Promise<unknown>
    deleteMany(args: { where: { action: { in: string[] }; createdAt: { lt: Date } } }): Promise<unknown>
  }
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

/** Reads the evidence. Read-only; every Supabase object is probed with to_regclass first, so this works before the migrations exist. */
export async function collectSnapshot(db: Db, now: Date): Promise<Snapshot> {
  const overdueCutoff = new Date(now.getTime() - THRESHOLDS.overdueGraceMinutes * 60_000)
  const overdue = await db.article.aggregate({
    where: { status: 'SCHEDULED', deletedAt: null, scheduledAt: { lt: overdueCutoff } },
    _count: { _all: true },
    _min: { scheduledAt: true },
  })

  const supabase: Snapshot['supabase'] = { state: 'not_installed', lastInvokedAt: null, recent: [], warningRuns24h: 0 }
  try {
    const [probe] = await db.$queryRaw<{ cron: boolean; log: boolean }[]>`
      select to_regclass('cron.job') is not null as cron, to_regclass('public.scheduler_invocations') is not null as log`
    if (probe.cron && probe.log) {
      const jobs = await db.$queryRaw<{ active: boolean }[]>`select active from cron.job where jobname = 'publish-scheduled'`
      if (jobs.length === 0) supabase.state = 'not_scheduled'
      else if (!jobs[0].active) supabase.state = 'job_inactive'
      else {
        supabase.state = 'active'
        // Times are read as epoch milliseconds, never as timestamptz: Prisma's raw-query path shifts a
        // timestamptz by the SESSION time zone's offset, which made a stale scheduler look fresh (found
        // by running these tests in a Europe/London session; Supabase sessions are UTC, so it would have
        // hidden until that changed). Epoch is the same instant in every session.
        const [last] = await db.$queryRaw<{ ms: number | null }[]>`
          select (extract(epoch from max(invoked_at)) * 1000)::float8 as ms
          from public.scheduler_invocations where job = 'publish-scheduled'`
        supabase.lastInvokedAt = last?.ms != null ? new Date(Number(last.ms)) : null
        const recent = await db.$queryRaw<{ outcome: string; ms: number; warningCount: number | null }[]>`
          select outcome, (extract(epoch from invoked_at) * 1000)::float8 as ms, warning_count as "warningCount"
          from public.scheduler_invocations
          where job = 'publish-scheduled' and outcome <> 'pending'
          order by id desc limit 12`
        supabase.recent = recent.map((r) => ({ outcome: r.outcome, invokedAt: new Date(Number(r.ms)), warningCount: r.warningCount }))
        // The window is computed by the database's own clock, so no timestamp crosses the driver.
        const [warned] = await db.$queryRaw<{ n: number }[]>`
          select count(*)::int as n from public.scheduler_invocations
          where job = 'publish-scheduled' and outcome = 'success' and warning_count > 0
            and invoked_at > now() - make_interval(hours => ${THRESHOLDS.warningWindowHours}::int)`
        supabase.warningRuns24h = warned?.n ?? 0
      }
    }
  } catch (error) {
    // Server-side log only (the message can name database objects): the response just says "unreadable".
    console.error('[scheduler-health] could not read the Supabase scheduler records:', error instanceof Error ? error.message : error)
    supabase.state = 'unreadable'
  }

  return {
    now,
    overdue: { count: overdue._count._all, oldestScheduledAt: overdue._min.scheduledAt },
    supabase,
  }
}

const ACTION_ALERT = 'scheduler_health.alert'
const ACTION_RECOVERED = 'scheduler_health.recovered'
const STATE_ROW = { targetId: 'scheduler-health', targetType: 'system', performedBy: 'system:scheduler-health' } as const

export interface HealthReport {
  checkedAt: string
  /** No problems right now. */
  ok: boolean
  /** The workflow should fail (and so email) on this run. */
  alert: boolean
  /** Why: a new set of problems, or a reminder that they persist. Absent when `alert` is false. */
  alertReason?: 'new' | 'changed' | 'reminder'
  /** Problems have just cleared since the last alert. */
  recovered: boolean
  problems: Problem[]
  supabase: { state: SupabaseState; lastCallMinutesAgo: number | null }
  overdue: { count: number; oldestMinutesOverdue: number | null }
}

/** Runs the check, applies the alert de-duplication, and records alert state. */
export async function runHealthCheck(db: Db, now = new Date()): Promise<HealthReport> {
  const snapshot = await collectSnapshot(db, now)
  const problems = evaluateHealth(snapshot)
  const keys = problems.map((p) => p.key).sort().join(',')

  const last = await db.auditLog.findFirst({
    where: { action: { in: [ACTION_ALERT, ACTION_RECOVERED] } },
    // id breaks a tie between rows written in the same millisecond (cuids are time-ordered).
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true, createdAt: true, metadata: true },
  })
  const lastKeys = last?.action === ACTION_ALERT ? String((last.metadata as { keys?: string } | null)?.keys ?? '') : null
  const lastAgeHours = last ? (now.getTime() - last.createdAt.getTime()) / 3_600_000 : Infinity

  let alert = false
  let alertReason: HealthReport['alertReason']
  let recovered = false

  if (problems.length === 0) {
    if (lastKeys !== null) {
      recovered = true
      await writeState(db, ACTION_RECOVERED, { cleared: lastKeys }, now)
    }
  } else if (lastKeys === null) {
    alert = true
    alertReason = 'new'
  } else if (lastKeys !== keys) {
    alert = true
    alertReason = 'changed'
  } else if (lastAgeHours >= THRESHOLDS.reminderHours) {
    alert = true
    alertReason = 'reminder'
  }
  if (alert) await writeState(db, ACTION_ALERT, { keys }, now)

  return {
    checkedAt: now.toISOString(),
    ok: problems.length === 0,
    alert,
    ...(alertReason ? { alertReason } : {}),
    recovered,
    problems,
    supabase: {
      state: snapshot.supabase.state,
      lastCallMinutesAgo: snapshot.supabase.lastInvokedAt ? minutesBetween(now, snapshot.supabase.lastInvokedAt) : null,
    },
    overdue: {
      count: snapshot.overdue.count,
      oldestMinutesOverdue: snapshot.overdue.oldestScheduledAt ? minutesBetween(now, snapshot.overdue.oldestScheduledAt) : null,
    },
  }
}

/**
 * Records an alert or a recovery. If the write fails the alert is still returned (the caller already
 * decided to alert): losing de-duplication state costs at most one repeat email, never a missed alert.
 */
async function writeState(db: Db, action: string, metadata: Record<string, string>, now: Date) {
  try {
    await db.auditLog.create({ data: { action, ...STATE_ROW, metadata } })
    await db.auditLog.deleteMany({
      where: {
        action: { in: [ACTION_ALERT, ACTION_RECOVERED] },
        createdAt: { lt: new Date(now.getTime() - THRESHOLDS.stateRetentionDays * 86_400_000) },
      },
    })
  } catch (error) {
    console.error('[scheduler-health] could not record alert state:', error instanceof Error ? error.message : error)
  }
}
