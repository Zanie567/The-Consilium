import type { Metadata } from 'next'
import { PortalShell } from '@/components/layout/PortalShell'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'

// Everything under this layout is gated. Declaring it once here means a new
// page cannot forget it — several already had, and were inheriting the root
// layout's `index: true`. A page may still override this.
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW_ROBOTS }

export default async function EditorialLayout({ children }: { children: React.ReactNode }) {
  // Invoked directly (not as <PortalShell>) so the layout resolves to the verified frame itself.
  return PortalShell({ children })
}
