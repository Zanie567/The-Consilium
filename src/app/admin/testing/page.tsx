import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions, getVerifiedSessionUser } from '@/lib/auth'
import { TestingControls } from '@/components/layout/TestingControls'
import { requireTestingWorkspace } from '@/lib/testingMode'
import { testingWorkspaceLink } from '@/lib/testingWorkspaceLink'
export const dynamic = 'force-dynamic'
export default async function TestingPage() {
  const session = await getServerSession(authOptions)
  if (!session?.testing && !await getVerifiedSessionUser(['ADMIN'])) redirect('/editorial')
  let unavailable: string | null = null
  const workspaceLink = testingWorkspaceLink(process.env.TESTING_WORKSPACE_URL)
  try { await requireTestingWorkspace() } catch (error) { unavailable = (error as Error).message }
  return <div><h1 className="text-3xl mb-4">Testing</h1>
    <p className="mb-4">Run the real workflows using dedicated accounts on an isolated workspace. Sessions expire after 15 minutes and are shared across tabs. Switching or exiting invalidates old forms.</p>
    {unavailable ? <p role="alert">Unavailable: {unavailable}</p> : <TestingControls testing={session?.testing} />}
    {unavailable && workspaceLink && <a className="underline" href={workspaceLink}>Open testing workspace (sign in independently)</a>}
    {unavailable && process.env.TESTING_WORKSPACE_URL && !workspaceLink && <p role="alert">Testing workspace link is invalid. Configure a credential-free origin without a path, query or fragment.</p>}
  </div>
}
