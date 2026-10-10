import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { authOptions, getVerifiedSessionUser } from '@/lib/auth'
import { TestingControls } from '@/components/layout/TestingControls'
import { TestingScenarios } from '@/components/admin/TestingScenarios'
import { requireTestingWorkspace } from '@/lib/testingMode'
import { testingWorkspaceLink } from '@/lib/testingWorkspaceLink'
import { SETUP_STEPS_LOCAL, WHY_UNAVAILABLE, testingSetupStatus } from '@/lib/testingSetup'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Testing | Editorial' }

export default async function TestingPage() {
  const session = await getServerSession(authOptions)
  if (!session?.testing && !await getVerifiedSessionUser(['ADMIN'])) redirect('/editorial')

  let unavailable: string | null = null
  const workspaceLink = testingWorkspaceLink(process.env.TESTING_WORKSPACE_URL)
  try { await requireTestingWorkspace() } catch (error) { unavailable = (error as Error).message }
  const setup = testingSetupStatus()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <header className="mb-6 pl-10 md:pl-0">
        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-serif)' }}>Testing</h1>
        <p className="text-sm opacity-80">
          Run the real workflows as a writer, editor or growth member, using dedicated accounts on an isolated workspace, to see exactly what each
          of them sees. Sessions expire after 15 minutes and are shared across tabs. Switching or exiting invalidates old forms.
        </p>
        <p className="mt-2 inline-block border border-[var(--border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest" data-testid="testing-environment">
          {unavailable ? 'Live site · testing unavailable' : 'Isolated test workspace'}
        </p>
      </header>

      {unavailable ? (
        <div className="space-y-6">
          <p role="alert">Unavailable: {unavailable}</p>

          <section aria-labelledby="why-heading" className="space-y-2">
            <h2 id="why-heading" className="text-lg font-bold">Why is it unavailable?</h2>
            <p className="text-sm opacity-90">{WHY_UNAVAILABLE}</p>
          </section>

          <section aria-labelledby="checklist-heading" className="space-y-2">
            <h2 id="checklist-heading" className="text-lg font-bold">What this deployment is missing</h2>
            <ul className="divide-y divide-[var(--border)] border border-[var(--border)]" data-testid="testing-checklist">
              {setup.checks.map((check) => (
                <li key={check.id} className="p-3 text-sm">
                  <p className="font-semibold">
                    <span aria-hidden className={check.ok ? 'text-emerald-600' : 'text-red-500'}>{check.ok ? '✓' : '✗'}</span>{' '}
                    <span className="sr-only">{check.ok ? 'Met: ' : 'Not met: '}</span>{check.label}
                  </p>
                  {!check.ok && <p className="mt-0.5 text-xs opacity-80">{check.hint}</p>}
                </li>
              ))}
              {setup.ready && (
                <li className="p-3 text-sm">
                  <p className="font-semibold"><span aria-hidden className="text-red-500">✗</span> <span className="sr-only">Not met: </span>The database is attested as this workspace</p>
                  <p className="mt-0.5 text-xs opacity-80">Run <code>npm run testing:seed</code> against this database so it carries this workspace’s marker and the five test personas.</p>
                </li>
              )}
            </ul>
          </section>

          <section aria-labelledby="setup-heading" className="space-y-2">
            <h2 id="setup-heading" className="text-lg font-bold">How to set it up safely</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {SETUP_STEPS_LOCAL.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="text-sm opacity-80">
              A separate hosted workspace can be used instead. Never switch Testing Mode on for the live site, or for any deployment that shares its
              database or storage. Full instructions: <code>docs/testing/appointments-and-testing-mode.md</code> and <code>docs/admin-overhaul/TESTING-MODE.md</code>.
            </p>
          </section>

          {workspaceLink && <a className="underline" href={workspaceLink}>Open testing workspace (sign in independently)</a>}
          {process.env.TESTING_WORKSPACE_URL && !workspaceLink && <p role="alert">Testing workspace link is invalid. Configure a credential-free origin without a path, query or fragment.</p>}
        </div>
      ) : (
        <div className="space-y-8">
          <TestingControls testing={session?.testing} />
          <TestingScenarios testing={session?.testing} />
        </div>
      )}
    </div>
  )
}
