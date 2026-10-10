import { NextResponse } from 'next/server'
import { requireVerifiedSessionUser } from '@/lib/auth'
import { ADMIN_ONLY } from '@/lib/rbac'
import { loadTeamDirectory } from '@/lib/teamDirectory'
import { apiServerErrorResponse } from '@/lib/apiResponse'

export const dynamic = 'force-dynamic'

// The whole Team Members screen in one read: people, unowned cards, recent sign-ups and
// consistency findings. Administrators only.
export async function GET() {
  const auth = await requireVerifiedSessionUser(ADMIN_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await loadTeamDirectory())
  } catch (error) {
    return apiServerErrorResponse(error, {
      operation: 'team-directory:load',
      userMessage: 'The team list could not be loaded. Reload to try again.',
      code: 'TEAM_DIRECTORY_FAILED',
    })
  }
}
