import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import { ACHIEVEMENT_TYPES, COMMISSIONING_BRIEF_KEY, STREAK_INTERVAL_WEEKS } from '@/lib/constants'
import { isStreakStillActive } from '@/lib/gamification/streaks'
import { NotificationBell } from '@/components/editorial/NotificationBell'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import { DraftsSection } from '@/components/editorial/DraftsSection'
import { TrophySection, type TrophyRecord } from '@/components/editorial/TrophySection'
import { StreakCard } from '@/components/editorial/StreakCard'
import { StreakCadenceControl } from '@/components/editorial/StreakCadenceControl'
import { FirstPublishBanner } from '@/components/editorial/FirstPublishBanner'
import { SeriesCompleteBadges } from '@/components/editorial/SeriesCompleteBadges'
import { CommissioningBriefEditor } from '@/components/editorial/CommissioningBriefEditor'
import { ReadQualityBadge } from '@/components/editorial/ReadQualityBadge'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard | Editorial',
  robots: { index: false, follow: false },
}

export default async function EditorialDashboard() {
  const session = await getServerSession(authOptions)
  if (!session) return null

  const userId = session.user.id
  const role = session.user.role
  const isAdmin = role === 'ADMIN'
  const isEditor = role === 'ADMIN' || role === 'EDITOR'
  const isGrowth = role === 'GROWTH'
  const isWriter = role === 'WRITER'
  // Streaks, achievement banners and the streak card are for authors only.
  const isWriterOrAdmin = isWriter || isAdmin

  let assignedCategoryIds: string[] | null = null
  if (role === 'EDITOR') {
    const assignments = await prisma.categoryEditor.findMany({
      where: { userId },
      select: { categoryId: true },
    })
    assignedCategoryIds = assignments.map((a) => a.categoryId)
  }

  // Wrap all DB queries so a failure surfaces as an error banner rather
  // than silently returning empty data that makes the dashboard look healthy.
  let fetchError = false
  const [myArticles, pendingArticles, publishedCount, myDrafts, totalViews, userCount] =
    await Promise.all([
      // Growth users don't need the articles table list
      isGrowth
        ? Promise.resolve([])
        : prisma.article.findMany({
            where: role === 'WRITER' ? { authorId: userId, deletedAt: null } : { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 8,
            include: { category: true, author: true },
          }),

      isEditor
        ? prisma.article.findMany({
            where: {
              status: 'PENDING_REVIEW',
              deletedAt: null,
              ...(assignedCategoryIds ? { categoryId: { in: assignedCategoryIds } } : {}),
            },
            orderBy: { updatedAt: 'asc' },
            take: 10,
            include: { author: true, category: true, _count: { select: { views: true } } },
          })
        : Promise.resolve([]),

      prisma.article.count({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
          ...(role === 'WRITER' ? { authorId: userId } : {}),
        },
      }),

      // Growth users don't have drafts
      isGrowth
        ? Promise.resolve([])
        : prisma.article.findMany({
            where: { authorId: userId, status: 'DRAFT', deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 10,
            select: {
              id: true,
              title: true,
              updatedAt: true,
              content: true,
              category: { select: { name: true } },
            },
          }) as Promise<{ id: string; title: string; updatedAt: Date; content: string; category: { name: string } | null }[]>,

      // Growth users also see total views
      isEditor || isGrowth
        ? prisma.article.aggregate({ where: { deletedAt: null }, _sum: { viewCount: true } })
            .then((r) => r._sum.viewCount ?? 0)
        : Promise.resolve(0),

      // Single source of truth: total registered accounts — the same number the
      // "Users" card links to on /editorial/users (GET /api/admin/stats → total).
      // Previously this counted only ADMIN/EDITOR/WRITER, so the dashboard showed
      // "7" while the users page showed "12" for the same data (Priority 4).
      isEditor
        ? prisma.user.count()
        : Promise.resolve(0),
    ]).catch((err) => {
      console.error('[editorial/dashboard] DB error:', err)
      // eslint-disable-next-line react-hooks/immutability -- server component, no render cycle
      fetchError = true
      return [[], [], 0, [], 0, 0] as const
    })

  const statusColour: Record<string, string> = {
    DRAFT: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
    PENDING_REVIEW: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    PUBLISHED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    REJECTED: 'bg-red-500/10 text-red-600 dark:text-red-400',
    ARCHIVED: 'bg-[var(--bg-subtle)] text-[var(--fg-faint)]',
  }

  const wordCount = (content: string) => {
    try {
      const parsed = JSON.parse(content)
      const text = JSON.stringify(parsed).replace(/<[^>]+>/g, '')
      return Math.round(text.split(/\s+/).filter(Boolean).length * 0.75)
    } catch {
      return content.split(/\s+/).filter(Boolean).length
    }
  }

  const rawTrophies = !isGrowth
    ? await prisma.articleTrophy
        .findMany({
          where: { article: { authorId: userId, deletedAt: null } },
          include: { article: { select: { title: true, slug: true } } },
          orderBy: { awardedAt: 'desc' },
        })
        .catch((err) => {
          console.error('[editorial/dashboard] Trophy fetch error:', err)
          fetchError = true
          return []
        })
    : []

  const myTrophies: TrophyRecord[] = rawTrophies.map((t) => ({
    id: t.id,
    trophy: t.trophy,
    awardedAt: t.awardedAt.toISOString(),
    seenAt: t.seenAt?.toISOString() ?? null,
    article: t.article,
  }))

  // Publishing streak (WRITER + ADMIN only), fetched server-side via Prisma the
  // same way trophies are, rather than through the /api/user/streak route.
  const streak = isWriterOrAdmin
    ? await prisma.writerStreak.findUnique({ where: { userId } }).catch((err) => {
        console.error('[editorial/dashboard] Streak fetch error:', err)
        return null
      })
    : null

  // Unseen one-time achievements (WRITER + ADMIN only) that drive the dashboard
  // banners. Seen ones are filtered out in the query so they never render.
  const unseenAchievements = isWriterOrAdmin
    ? await prisma.writerAchievement
        .findMany({ where: { userId, seenAt: null }, orderBy: { awardedAt: 'desc' } })
        .catch((err) => {
          console.error('[editorial/dashboard] Achievement fetch error:', err)
          return []
        })
    : []

  const firstPublishAchievement =
    unseenAchievements.find((a) => a.type === ACHIEVEMENT_TYPES.FIRST_PUBLISH) ?? null
  const seriesCompleteAchievements = unseenAchievements.filter(
    (a) => a.type === ACHIEVEMENT_TYPES.SERIES_COMPLETE
  )

  // Resolve series titles for the series-complete badges (referenceId is the series id).
  const seriesAchievementIds = seriesCompleteAchievements
    .map((a) => a.referenceId)
    .filter((id): id is string => Boolean(id))
  const seriesTitles = seriesAchievementIds.length
    ? await prisma.series
        .findMany({ where: { id: { in: seriesAchievementIds } }, select: { id: true, title: true } })
        .catch(() => [] as { id: string; title: string }[])
    : []
  const seriesTitleById = new Map(seriesTitles.map((s) => [s.id, s.title]))

  // Commissioning brief: writers see the text, ADMIN/GROWTH edit it. Fetched
  // server-side; the read is guarded because the site_settings table may not exist
  // yet (see the WAITING FOR SCHEMA note), in which case the brief is treated as absent.
  const commissioningBrief =
    isWriter || isAdmin || isGrowth
      ? await prisma.siteSetting
          .findUnique({ where: { key: COMMISSIONING_BRIEF_KEY }, select: { value: true } })
          .then((s) => s?.value ?? null)
          .catch(() => null)
      : null

  const growthMetrics = isGrowth
    ? await loadGrowthMetrics()
    : null

  return (
    <PortalPage className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      {/* Surface DB errors rather than silently rendering empty data */}
      {fetchError && (
        <div className="mb-6 bg-red-500/10 border border-red-500/20 px-5 py-4 text-red-600 dark:text-red-400 text-sm">
          Some dashboard data could not be loaded. This is usually a temporary database issue.
          Please refresh the page.
        </div>
      )}

      {/* Header - on mobile, add left padding to clear the hamburger button */}
      <PortalSection className="flex items-start justify-between mb-6 sm:mb-8">
        <div className="pl-10 md:pl-0">
          <h1
            className="text-2xl font-bold text-[var(--fg)] mb-1"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {isGrowth ? 'Welcome to your Growth dashboard.' : 'Welcome back.'}
          </h1>
          <p className="text-[var(--fg-muted)] text-sm">
            {isGrowth
              ? 'Track audience growth, engagement, and community activity.'
              : isAdmin
              ? 'You have full editorial access.'
              : isEditor
              ? 'Manage the review queue and editorial content.'
              : 'Write and manage your articles.'}
          </p>
        </div>
        <NotificationBell />
      </PortalSection>

      {/* One-time achievement banners (first publish, then series completion) */}
      {firstPublishAchievement && (
        <FirstPublishBanner achievementId={firstPublishAchievement.id} />
      )}
      {seriesCompleteAchievements.length > 0 && (
        <SeriesCompleteBadges
          items={seriesCompleteAchievements.map((a) => ({
            id: a.id,
            title: a.referenceId ? seriesTitleById.get(a.referenceId) ?? null : null,
          }))}
        />
      )}

      {/* Stats row */}
      <PortalSection className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {!isGrowth && <StatCard label="My Drafts" value={myDrafts.length} />}
        <StatCard label="Published" value={publishedCount} accent="emerald" />
        {isEditor && (
          <StatCard
            label="Pending Review"
            value={pendingArticles.length}
            accent={pendingArticles.length > 0 ? 'amber' : undefined}
          />
        )}
        {(isEditor || isGrowth) && (
          <StatCard label="Total Views" value={totalViews.toLocaleString()} />
        )}
        {isAdmin && (
          <Link href="/editorial/users">
            <StatCard label="Users" value={userCount} />
          </Link>
        )}
        {isWriterOrAdmin && (
          <StreakCard
            currentStreak={
              streak?.currentStreak && streak.lastPublishedAt &&
              isStreakStillActive(streak.lastPublishedAt, streak.intervalWeeks ?? STREAK_INTERVAL_WEEKS.DEFAULT)
                ? streak.currentStreak
                : 0
            }
          />
        )}
      </PortalSection>

      {/* Streak cadence - writers/admins choose how often they must publish */}
      {isWriterOrAdmin && (
        <PortalSection className="mb-6 sm:mb-8">
          <StreakCadenceControl
            initialIntervalWeeks={streak?.intervalWeeks ?? STREAK_INTERVAL_WEEKS.DEFAULT}
          />
        </PortalSection>
      )}

      {growthMetrics && (
        <PortalSection className="mb-6 sm:mb-8">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--fg)] mb-4">
                Audience Growth
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Subscribers" value={growthMetrics.subscriberCount.toLocaleString()} />
                <StatCard label="New 30 Days" value={growthMetrics.newSubscribers.toLocaleString()} accent="emerald" />
                <StatCard label="Views 30 Days" value={growthMetrics.viewsLast30.toLocaleString()} />
                <StatCard label="Total Views" value={totalViews.toLocaleString()} />
              </div>
            </div>
            <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--fg)] mb-4">
                Traffic Sources
              </h2>
              <div className="space-y-3">
                {growthMetrics.sources.length > 0 ? (
                  growthMetrics.sources.map((source) => (
                    <div key={source.label} className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0">
                      <span className="text-sm text-[var(--fg-muted)]">{source.label}</span>
                      <span className="text-sm font-semibold text-[var(--fg)]">{source.count.toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--fg-faint)]">No source data yet.</p>
                )}
              </div>
            </div>
          </div>
        </PortalSection>
      )}

      {/* Pending Review queue */}
      {isEditor && pendingArticles.length > 0 && (
        <PortalSection className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[var(--fg)] uppercase tracking-widest">
              Pending Review
              <span className="ml-2 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingArticles.length}
              </span>
            </h2>
          </div>
          <div className="bg-[var(--bg-elevated)] border border-amber-500/20 overflow-hidden shadow-[var(--shadow-card)]">
            {pendingArticles.map((article, i) => (
              <div
                key={article.id}
                className={`flex items-start sm:items-center gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:bg-[var(--bg-subtle)] transition-colors ${
                  i > 0 ? 'border-t border-[var(--border)]' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/editorial/review/${article.id}`}
                    className="font-semibold text-[var(--fg)] hover:text-gold transition-colors line-clamp-2 sm:line-clamp-1 text-sm"
                  >
                    {/* Bug 7 */}
                    {article.title || <span className="italic text-[var(--fg-faint)]">(Untitled)</span>}
                  </Link>
                  <p className="text-[var(--fg-faint)] text-xs mt-0.5 line-clamp-2">
                    {article.author.name} · {article.category?.name ?? 'Uncategorised'} ·{' '}
                    {wordCount(article.content).toLocaleString()} words ·{' '}
                    submitted {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
                  </p>
                </div>
                <Link
                  href={`/editorial/review/${article.id}`}
                  className="shrink-0 bg-gold text-navy text-xs font-bold px-3 sm:px-4 py-2 sm:py-1.5 uppercase tracking-widest hover:bg-gold/90 transition-colors min-h-[44px] flex items-center"
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </PortalSection>
      )}

      {/* Quick actions - hidden for growth users */}
      {!isGrowth && (
        <PortalSection className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 mb-6 sm:mb-8">
          <Link
            href="/editorial/articles/new"
            className="flex items-center justify-center gap-2 bg-navy text-gold px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            + New Article
          </Link>
          <Link
            href="/editorial/articles"
            className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            All Articles
          </Link>
          {isAdmin && (
            <Link
              href="/editorial/users"
              className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
            >
              Manage Users
            </Link>
          )}
          {isEditor && (
            <Link
              href="/editorial/series"
              className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
            >
              Article Series
            </Link>
          )}
        </PortalSection>
      )}

      {/* Growth quick links */}
      {isGrowth && (
        <PortalSection className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 mb-6 sm:mb-8">
          <Link
            href="/editorial/analytics"
            className="flex items-center justify-center gap-2 bg-navy text-gold px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            View Analytics
          </Link>
          <Link
            href="/editorial/growth/subscribers"
            className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            Subscribers
          </Link>
          <Link
            href="/editorial/growth/writer-activity"
            className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            Writer Activity
          </Link>
          <Link
            href="/editorial/growth/engagement"
            className="flex items-center justify-center gap-2 border border-[var(--border)] text-[var(--fg-muted)] px-5 py-3 sm:py-2.5 text-xs font-bold uppercase tracking-widest hover:border-gold hover:text-gold transition-[colors,transform] duration-100 min-h-[44px] active:scale-[0.97]"
          >
            Engagement
          </Link>
        </PortalSection>
      )}

      {/* Commissioning brief editor - ADMIN and GROWTH only. Writers see the
          rendered brief above their article table instead. */}
      {(isAdmin || isGrowth) && (
        <PortalSection className="mb-6 sm:mb-8">
          <CommissioningBriefEditor initialBrief={commissioningBrief} userRole={role} />
        </PortalSection>
      )}

      {/* Trophies - hidden for growth users */}
      {!isGrowth && myTrophies.length > 0 && (
        <PortalSection className="mb-8">
          <TrophySection trophies={myTrophies} />
        </PortalSection>
      )}

      {/* My Drafts - hidden for growth */}
      {!isGrowth && myDrafts.length > 0 && (
        <PortalSection className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              My Drafts
              <span className="ml-2 text-[var(--fg-faint)] font-normal normal-case tracking-normal">
                {myDrafts.length} saved
              </span>
            </h2>
            <Link
              href="/editorial/articles?status=DRAFT"
              className="text-xs text-gold hover:underline"
            >
              View all →
            </Link>
          </div>
          <DraftsSection
            drafts={myDrafts.map((draft) => ({
              id: draft.id,
              title: draft.title,
              updatedAt: draft.updatedAt,
              wordCount: wordCount(draft.content),
              category: draft.category,
            }))}
          />
        </PortalSection>
      )}

      {/* Commissioning brief - writers only. Signals what the desk wants now. */}
      {isWriter && commissioningBrief && commissioningBrief.trim() !== '' && (
        <PortalSection className="mb-6 sm:mb-8">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] border-l-4 border-l-gold p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gold mb-2">
              What we are looking for
            </h2>
            <p className="text-sm text-[var(--fg)] whitespace-pre-line">{commissioningBrief}</p>
          </div>
        </PortalSection>
      )}

      {/* Recent articles table - hidden for growth */}
      {!isGrowth && <PortalSection>
        <div className="bg-[var(--bg-elevated)] border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-xs font-bold text-[var(--fg)] uppercase tracking-widest">
              {role === 'WRITER' ? 'My Articles' : 'Recent Articles'}
            </h2>
            <Link href="/editorial/articles" className="text-xs text-gold hover:underline">
              View all →
            </Link>
          </div>
          {myArticles.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-6 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Article
                    </th>
                    <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden sm:table-cell">
                      Category
                    </th>
                    <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden md:table-cell">
                      Updated
                    </th>
                    {isWriter && (
                      <th className="px-4 py-2.5 text-left text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider hidden lg:table-cell">
                        Quality
                      </th>
                    )}
                    <th className="px-4 py-2.5 text-right text-[var(--fg-faint)] text-xs font-semibold uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {myArticles.map((article) => (
                    <tr key={article.id} className="hover:bg-[#faf8f4] active:bg-gold/10 transition-colors duration-100 cursor-pointer" style={{ minHeight: '52px' }}>
                      <td className="px-6 py-3" style={{ minHeight: '52px' }}>
                        <Link
                          href={`/editorial/articles/${article.id}/edit`}
                          className="font-medium text-[var(--fg)] hover:text-gold transition-colors line-clamp-1"
                        >
                          {/* Bug 7 */}
                          {article.title || <span className="italic text-[var(--fg-faint)]">(Untitled)</span>}
                        </Link>
                        {isEditor && (
                          <p className="text-[var(--fg-faint)] text-xs mt-0.5">
                            {article.author.name}
                          </p>
                        )}
                        {article.editorialCommendation && (
                          <p className="mt-1 border-l-2 border-gold pl-2 text-xs italic text-gold">
                            {article.editorialCommendation}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden sm:table-cell">
                        {article.category?.name ?? 'Uncategorised'}
                      </td>
                      <td className="px-4 py-3 text-[var(--fg-faint)] text-xs hidden md:table-cell">
                        {format(new Date(article.updatedAt), 'd MMM yyyy')}
                      </td>
                      {isWriter && (
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {article.status === 'PUBLISHED' && (
                            <ReadQualityBadge score={article.engagementScore} />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-bold px-2 py-0.5 ${statusColour[article.status] ?? ''}`}>
                          {article.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-16 text-center text-[var(--fg-faint)] text-sm">
              No articles yet.{' '}
              <Link href="/editorial/articles/new" className="text-gold hover:underline">
                Write your first article.
              </Link>
            </div>
          )}
        </div>
      </PortalSection>}
    </PortalPage>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: 'emerald' | 'amber'
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : accent === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-[var(--fg)]'

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border)] p-4 sm:p-5 shadow-[var(--shadow-card)]">
      <p className="text-[var(--fg-faint)] text-[10px] sm:text-xs uppercase tracking-widest mb-1 sm:mb-2 truncate">{label}</p>
      <p className={`text-2xl sm:text-3xl font-bold ${valueClass}`} style={{ fontFamily: 'var(--font-serif)' }}>
        {value}
      </p>
    </div>
  )
}

async function loadGrowthMetrics() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [subscriberCount, newSubscribers, viewsLast30, recentViews] = await Promise.all([
    prisma.subscriber.count().catch(() => 0),
    prisma.subscriber.count({ where: { subscribedAt: { gte: since } } }).catch(() => 0),
    prisma.articleView.count({ where: { viewedAt: { gte: since } } }).catch(() => 0),
    prisma.articleView
      .findMany({
        where: { viewedAt: { gte: since } },
        select: { source: true, referrer: true },
        take: 500,
      })
      .catch(() => [] as { source: string | null; referrer: string | null }[]),
  ])

  const counts = new Map<string, number>()
  for (const view of recentViews) {
    const label = view.source || classifyReferrer(view.referrer)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return {
    subscriberCount,
    newSubscribers,
    viewsLast30,
    sources: Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  }
}

function classifyReferrer(referrer: string | null): string {
  if (!referrer) return 'Direct'
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '')
    if (host.includes('google')) return 'Search'
    if (host.includes('linkedin')) return 'LinkedIn'
    if (host.includes('instagram')) return 'Instagram'
    if (host.includes('twitter') || host.includes('x.com') || host.includes('t.co')) return 'X'
    return host || 'Other'
  } catch {
    return 'Other'
  }
}
