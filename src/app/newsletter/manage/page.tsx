import type { Metadata } from 'next'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'
import { NewsletterShell } from '@/components/newsletter/NewsletterShell'
import { ManageLinkForm } from '@/components/newsletter/ManageLinkForm'

export const metadata: Metadata = { title: 'Manage your newsletter', robots: NOINDEX_NOFOLLOW_ROBOTS }

export default function ManagePage() {
  return (
    <NewsletterShell title="Manage your newsletter" intro="Change topics or unsubscribe. For your privacy we email the link rather than showing your details here.">
      <ManageLinkForm />
    </NewsletterShell>
  )
}
