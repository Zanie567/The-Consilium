import { requirePortalRole } from '@/lib/portalAccess'
export default async function DebateLayout({children}:{children:React.ReactNode}) {
  await requirePortalRole(['ADMIN','EDITOR'])
  return children
}
