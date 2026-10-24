import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'
import { normaliseSearchText, type SearchParamValue } from '@/lib/searchText'
import { NewsletterShell } from '@/components/newsletter/NewsletterShell'
import { LegacyUnsubscribe } from '@/components/newsletter/LegacyUnsubscribe'
import { ManageLinkForm } from '@/components/newsletter/ManageLinkForm'
import { verifyLegacyUnsubscribeToken } from '@/lib/newsletter/subscriptions'

// Never indexable, and the tokenised address must not leak through Referer.
export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: NOINDEX_NOFOLLOW_ROBOTS,
  referrer: 'no-referrer',
}

/**
 * Opening this page NEVER changes anything. It used to delete the subscriber on GET, so any mail scanner or
 * link preview that fetched the link unsubscribed people (and kept no record). Now a valid old-style link
 * shows a button that POSTs the withdrawal, which is recorded and suppresses re-subscription without a fresh
 * confirmation. Anything else offers a preferences link by email.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  // Repeated query parameters arrive as arrays; normaliseSearchText reduces them safely.
  searchParams: Promise<{ email?: SearchParamValue; token?: SearchParamValue }>
}) {
  const params = await searchParams
  const email = normaliseSearchText(params.email, 320)
  const token = normaliseSearchText(params.token, 128)
  const valid = Boolean(email && token && verifyLegacyUnsubscribeToken(email, token))

  return (
    <NewsletterShell title="Unsubscribe" intro={valid ? undefined : 'Newsletter emails carry a one-step unsubscribe link. You can also manage your subscription with a link we email to you.'}>
      {valid && email && token ? <LegacyUnsubscribe email={email} legacyToken={token} /> : <ManageLinkForm compact />}
    </NewsletterShell>
  )
}
