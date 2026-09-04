import { format } from 'date-fns'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { FeaturedArticleHero, type HeroSlide } from '@/components/ui/FeaturedArticleHero'
import { readTimeLabel } from '@/lib/readTime'
import { displayAuthorName } from '@/lib/authorUtils'

interface ArticleBase {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  coverImage: string | null
  publishedAt: Date | string | null
  author: { name: string | null }
  category: { name: string; slug: string } | null
}

interface HeroSectionProps {
  /**
   * The hero rotation, already ordered and capped by `selectHeroArticles`. One
   * article renders the ordinary static hero; more than one rotates.
   */
  articles: ArticleBase[]
}

/**
 * Server half of the homepage hero. It resolves each article into a flat,
 * serializable slide — read time derived from the body here so the body itself
 * never ships to the browser, and the date formatted here so hydration cannot
 * disagree — and hands the small array to the client component that rotates it.
 */
export function HeroSection({ articles }: HeroSectionProps) {
  const slides: HeroSlide[] = articles.map((article) => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    coverImage: article.coverImage,
    categoryName: article.category?.name ?? null,
    readTime: readTimeLabel(article.content),
    authorName: displayAuthorName(article.author.name),
    dateLabel: article.publishedAt ? format(new Date(article.publishedAt), 'd MMMM yyyy') : '',
  }))

  return (
    <AnimateIn variant="fade-up" duration={0.6} className="mb-14">
      <FeaturedArticleHero slides={slides} />
    </AnimateIn>
  )
}
