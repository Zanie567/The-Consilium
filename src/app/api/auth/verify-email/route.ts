import { NextRequest, NextResponse } from 'next/server'
import { consumeEmailVerificationToken } from '@/lib/emailVerification'
import { verifyEmailAndClaim } from '@/lib/membership'
import { checkRateLimit, getIp } from '@/lib/rate-limit'

// POST /api/auth/verify-email: confirm an emailed link. A POST (from the button on
// /verify-email) rather than a GET so mail scanners that pre-fetch links cannot
// spend the single-use token. The only input is the token; the account it belongs to
// is found from the token, and that account's own invitation is the only thing claimed.
export async function POST(request: NextRequest) {
  const redirectTo = (status: string) => NextResponse.redirect(new URL(`/verify-email?status=${status}`, request.url), 303)

  if (!checkRateLimit(`verify-email-confirm:${getIp(request)}`, 20, 15 * 60 * 1000)) return redirectTo('error')

  let token = ''
  try {
    const form = await request.formData()
    const value = form.get('token')
    token = typeof value === 'string' ? value : ''
  } catch {
    return redirectTo('error')
  }

  const userId = await consumeEmailVerificationToken(token)
  if (!userId) return redirectTo('invalid')
  const claim = await verifyEmailAndClaim(userId).catch(() => null)
  return redirectTo(claim?.claimed ? 'activated' : 'ok')
}
