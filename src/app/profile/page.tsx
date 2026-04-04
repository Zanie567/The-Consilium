import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Image from 'next/image'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile | The Consilium',
}

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [user, bookmarks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true, bio: true, createdAt: true },
    }).catch(() => null),
    prisma.bookmark.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        article: {
          include: { author: true, category: true },
        },
      },
    }).catch(() => []),
  ])

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-12 px-4 border-b border-gold/25">
        <div className="max-w-4xl mx-auto flex items-center gap-6">
          {user?.image ? (
            <Image
              src={user.image}
              alt={user?.name ?? ''}
              width={72}
              height={72}
              className="rounded-full object-cover ring-2 ring-gold/30"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gold/20 flex items-center justify-center text-gold text-2xl font-bold shrink-0">
              {user?.name?.charAt(0) ?? session.user.email?.charAt(0) ?? '?'}
            </div>
          )}
          <div>
            <h1
              className="text-2xl font-bold text-cream"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {user?.name ?? session.user.email}
            </h1>
            <p className="text-cream/50 text-sm mt-0.5">{session.user.email}</p>
            {user?.createdAt && (
              <p className="text-cream/35 text-xs mt-1">
                Member since {format(new Date(user.createdAt), 'MMMM yyyy')}
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Saved articles */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="text-lg font-bold text-[var(--fg)]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Saved Articles
            <span className="ml-2 text-sm font-normal text-[var(--fg-faint)]">
              ({bookmarks.length})
            </span>
          </h2>
        </div>

        {bookmarks.length > 0 ? (
          <div className="space-y-4">
            {bookmarks.map(({ article }) => (
              <article
                key={article.id}
                className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 flex gap-5 hover:border-gold/40 transition-colors shadow-[var(--shadow-card)] group"
              >
                {/* Cover thumbnail */}
                <div className="relative w-24 h-20 shrink-0 overflow-hidden bg-navy/10">
                  {article.coverImage ? (
                    <Image
                      src={article.coverImage}
                      alt={article.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-light flex items-center justify-center">
                      <span
                        className="text-gold/20 text-xl font-bold"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        TC
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {article.category && (
                    <span className="text-gold text-[0.6rem] font-bold uppercase tracking-widest">
                      {article.category.name}
                    </span>
                  )}
                  <Link href={`/articles/${article.slug}`}>
                    <h3
                      className="text-[var(--fg)] font-bold text-base leading-snug mt-1 group-hover:text-gold transition-colors line-clamp-2"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {article.title}
                    </h3>
                  </Link>
                  {article.excerpt && (
                    <p className="text-[var(--fg-muted)] text-sm leading-relaxed mt-1 line-clamp-1">
                      {article.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-[var(--fg-faint)] mt-2">
                    <span>{article.author.name}</span>
                    {article.publishedAt && (
                      <>
                        <span className="text-gold/40">·</span>
                        <span>{format(new Date(article.publishedAt), 'd MMM yyyy')}</span>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center border border-dashed border-[var(--border)]">
            <p
              className="text-2xl font-bold text-[var(--fg-faint)] mb-2"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              No saved articles yet
            </p>
            <p className="text-[var(--fg-faint)] text-sm mb-6">
              Bookmark articles while reading to find them here.
            </p>
            <Link
              href="/"
              className="inline-block border border-[var(--fg-faint)] text-[var(--fg-muted)] text-xs font-bold uppercase tracking-widest px-8 py-3 hover:border-gold hover:text-gold transition-colors"
            >
              Browse Articles
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
