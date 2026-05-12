import { redirect, notFound } from 'next/navigation'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserProfileEditor } from '@/components/editorial/UserProfileEditor'
import type { Metadata } from 'next'
import { ADMIN_ONLY } from '@/lib/rbac'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } }).catch(() => null)
  return {
    title: user?.name ? `${user.name} | Users | Editorial` : 'User Profile | Editorial',
    robots: { index: false, follow: false },
  }
}

export default async function UserProfilePage({ params }: Props) {
  const session = await getVerifiedSessionUser(ADMIN_ONLY)
  if (!session) redirect('/editorial')

  const { id } = await params

  const [user, categories] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        slug: true, bio: true, image: true, createdAt: true, lastLoginAt: true, adminNotes: true,
        categoryAssignments: {
          select: { category: { select: { id: true, name: true, slug: true } } },
        },
        articles: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, slug: true, status: true,
            createdAt: true, publishedAt: true,
            category: { select: { name: true } },
          },
        },
      },
    }).catch(() => null),
    prisma.category.findMany({ orderBy: { name: 'asc' } }).catch(() => []),
  ])

  if (!user) notFound()

  const serialized = JSON.parse(JSON.stringify(user))

  return <UserProfileEditor user={serialized} categories={categories} />
}
