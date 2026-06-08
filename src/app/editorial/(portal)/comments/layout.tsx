import type { Metadata } from 'next'

// The comments page itself is a client component and so cannot export metadata.
// A thin segment layout supplies the page-specific <title> (matching the
// "<Name> | Editorial" pattern used by Trash, Users, etc.) without changing it
// to a server component.
export const metadata: Metadata = {
  title: 'Comment Moderation | Editorial',
  robots: { index: false, follow: false },
}

export default function CommentsLayout({ children }: { children: React.ReactNode }) {
  return children
}
