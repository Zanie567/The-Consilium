import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'
import { normaliseSearchText, type SearchParamValue } from '@/lib/searchText'
import { NewsletterShell } from '@/components/newsletter/NewsletterShell'
import { ManageLinkForm } from '@/components/newsletter/ManageLinkForm'
import { PreferenceCentre } from '@/components/newsletter/PreferenceCentre'
import { loadPreferences } from '@/lib/newsletter/subscriptions'

export const metadata: Metadata = { title: 'Newsletter preferences', robots: NOINDEX_NOFOLLOW_ROBOTS, referrer: 'no-referrer' }
export const dynamic = 'force-dynamic'

export default async function PreferencesPage({ searchParams }: { searchParams: Promise<{ token?: SearchParamValue }> }) {
  const token = normaliseSearchText((await searchParams).token, 64)
  // Read-only: viewing this page never changes a subscription.
  const view = token ? await loadPreferences(token).catch(() => null) : null
  if (!token || !view) {
    return (
      <NewsletterShell title="Newsletter preferences" intro="This preferences link has expired or is not valid. Links work for 14 days.">
        <ManageLinkForm />
      </NewsletterShell>
    )
  }
  return (
    <NewsletterShell title="Newsletter preferences" intro="Choose what The Consilium sends you. Changes apply to the next email.">
      <PreferenceCentre token={token} {...view} />
    </NewsletterShell>
  )
}
