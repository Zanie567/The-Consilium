import type { Metadata } from 'next'
import { SystemMessagePage } from '@/components/ui/SystemMessagePage'

export const metadata: Metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <SystemMessagePage
      eyebrow="Page not found"
      title="This page is not here"
      message="The page you are looking for does not exist, has moved, or is not available anymore. Use the homepage to get back to the live site."
    />
  )
}
