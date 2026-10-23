import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'
import { normaliseSearchText, type SearchParamValue } from '@/lib/searchText'
import { NewsletterShell } from '@/components/newsletter/NewsletterShell'
import { ConfirmPanel } from '@/components/newsletter/ConfirmPanel'
import { isWellFormedToken } from '@/lib/newsletter/tokens'

// Reached from an emailed link that carries a credential: never indexed, never leaked through Referer.
export const metadata: Metadata = { title: 'Confirm your subscription', robots: NOINDEX_NOFOLLOW_ROBOTS, referrer: 'no-referrer' }

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: SearchParamValue }> }) {
  const token = normaliseSearchText((await searchParams).token, 64)
  // Opening the page changes nothing: confirming is the button's POST.
  return (
    <NewsletterShell eyebrow="The Weekly Edition" title="Confirm your subscription">
      {token && isWellFormedToken(token) ? (
        <ConfirmPanel token={token} />
      ) : (
        <p role="alert" className="text-sm text-[var(--fg)]">
          This confirmation link is incomplete. Open the newest confirmation email and use its button.
        </p>
      )}
    </NewsletterShell>
  )
}
