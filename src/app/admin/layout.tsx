import type { Metadata } from 'next'
import { PortalShell } from '@/components/layout/PortalShell'
import { NOINDEX_NOFOLLOW_ROBOTS } from '@/lib/seo'

// Administration pages live in the same portal frame as the editorial ones, so the sidebar,
// theme and mobile menu are identical wherever an administrator navigates. Each page still
// enforces its own role on the server.
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW_ROBOTS }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return PortalShell({ children })
}
