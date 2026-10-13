import Link from 'next/link'
import { buildAttentionItems, type AdminOverview as Overview, type Count } from '@/lib/adminOverview'
import { PortalSection } from '@/components/editorial/PortalAnimated'

const show = (n: Count) => (n === null ? '—' : n.toLocaleString())

function Tile({ title, href, linkLabel, rows }: { title: string; href: string; linkLabel: string; rows: { label: string; value: Count; alert?: boolean }[] }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg)]">{title}</h3>
      <dl className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-[var(--fg-muted)]">{r.label}</dt>
            <dd className={`font-bold ${r.alert ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--fg)]'}`}>{show(r.value)}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-3 inline-block text-xs font-bold uppercase tracking-widest text-gold hover:underline">{linkLabel} →</Link>
    </div>
  )
}

/** The administrator's at-a-glance overview. Server-rendered from `loadAdminOverview`. */
export function AdminOverview({ overview }: { overview: Overview }) {
  const attention = buildAttentionItems(overview)
  const { content, debates, team, audience, system } = overview
  const unavailable = [content.published, debates.published, team.staff, audience.subscribers].some((v) => v === null)

  return (
    <PortalSection className="mb-6 sm:mb-8" >
      <section aria-labelledby="overview-heading" data-testid="admin-overview">
        <h2 id="overview-heading" className="sr-only">Administrator overview</h2>

        {unavailable && (
          <p role="alert" className="mb-3 border-l-2 border-amber-500 pl-3 text-xs text-amber-700 dark:text-amber-400">
            Some figures could not be loaded and are shown as “—”. Reload to try again.
          </p>
        )}

        <div className="mb-4 border border-[var(--border)] bg-[var(--bg-elevated)] p-4" aria-label="Needs attention">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg)]">Needs attention</h3>
          {attention.length === 0 ? (
            <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Nothing is waiting on you.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {attention.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className={`flex items-center justify-between gap-3 border-l-2 pl-3 text-sm hover:underline ${item.tone === 'warn' ? 'border-amber-500 text-[var(--fg)]' : 'border-[var(--border)] text-[var(--fg-muted)]'}`}>
                    <span>{item.message}</span>
                    <span aria-hidden className="text-gold">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile title="Content" href="/editorial/articles" linkLabel="All articles" rows={[
            { label: 'Published', value: content.published },
            { label: 'Drafts', value: content.drafts },
            { label: 'Awaiting review', value: content.pendingReview, alert: (content.pendingReview ?? 0) > 0 },
            { label: 'In trash', value: content.trashed },
          ]} />
          <Tile title="Debates" href="/editorial/debates" linkLabel="Manage debates" rows={[
            { label: 'Published', value: debates.published },
            { label: 'Unpublished', value: debates.unpublished },
            { label: 'Deleted', value: debates.deleted },
          ]} />
          <Tile title="Team members" href="/editorial/members" linkLabel="Team Members" rows={[
            { label: 'Team accounts', value: team.staff },
            { label: 'Without a public profile', value: team.needProfile, alert: (team.needProfile ?? 0) > 0 },
            { label: 'Invitations waiting', value: team.pendingInvites },
          ]} />
          <Tile title="Subscribers" href="/admin/subscribers" linkLabel="Subscribers" rows={[
            { label: 'Total', value: audience.subscribers },
            { label: 'New in 30 days', value: audience.newLast30Days },
            { label: 'Failed sign-ins (24h)', value: overview.security.failedSignIns24h },
          ]} />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="System status">
          <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg)]">Deployment</h3>
            <p className={`mt-2 text-sm ${system.deploymentHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {system.deploymentHealthy === null ? 'The deployment check could not run.' : system.deploymentHealthy ? 'All deployment checks pass.' : `${system.deploymentGaps.length} deployment check${system.deploymentGaps.length === 1 ? '' : 's'} failing.`}
            </p>
            {system.deploymentGaps.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-[var(--fg-muted)]">
                {system.deploymentGaps.slice(0, 4).map((g) => <li key={g}>{g}</li>)}
              </ul>
            )}
          </div>
          <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--fg)]">Testing mode</h3>
            <p className={`mt-2 text-sm ${system.testingReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--fg-muted)]'}`}>
              {system.testingReady ? 'Ready: an isolated workspace is configured.' : 'Not available here: no verified isolated workspace is configured.'}
            </p>
            <Link href="/admin/testing" className="mt-2 inline-block text-xs font-bold uppercase tracking-widest text-gold hover:underline">
              {system.testingReady ? 'Open Testing' : 'See what is needed'} →
            </Link>
          </div>
        </div>
      </section>
    </PortalSection>
  )
}
