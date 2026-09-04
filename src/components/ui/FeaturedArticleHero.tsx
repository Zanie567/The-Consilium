'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { useReducedMotion } from 'framer-motion'
import { BlurImage } from '@/components/ui/BlurImage'

/**
 * One hero state, fully resolved on the server. Everything the hero renders for
 * an article travels together in a single object, so image, category, read
 * time, headline, excerpt, byline, date and both links always describe the same
 * article — there is no state in which one slide's picture sits beside
 * another's headline.
 *
 * Deliberately flat strings: the article body never crosses to the client (read
 * time is computed server-side from it), and the date arrives pre-formatted so
 * the server render and the client hydration cannot disagree about it.
 */
export interface HeroSlide {
  id: string
  slug: string
  title: string
  excerpt: string | null
  coverImage: string | null
  categoryName: string | null
  readTime: string
  authorName: string
  dateLabel: string
}

/**
 * Dwell time per article. Long enough to take in the image, read the headline
 * and a few lines of the excerpt, and decide whether to open it — the pace of a
 * front page, not of an ad unit.
 */
const ROTATION_MS = 7500

/**
 * Crossfade between articles: long enough to read as a deliberate change, short
 * enough that the hero never feels sluggish.
 *
 * Applied inline rather than with a utility class because globals.css sets an
 * unlayered `html *` transition for theme switching, and unlayered rules outrank
 * Tailwind's layered utilities — `transition-opacity` alone silently does
 * nothing here. The reduced-motion block in globals.css uses `!important`, so it
 * still overrides this and the fade is dropped for readers who ask for that.
 */
const CROSSFADE = { transition: 'opacity 300ms ease-out' } as const

interface FeaturedArticleHeroProps {
  slides: HeroSlide[]
}

export function FeaturedArticleHero({ slides }: FeaturedArticleHeroProps) {
  const [index, setIndex] = useState(0)
  const [engaged, setEngaged] = useState(false)
  const [tabVisible, setTabVisible] = useState(true)
  const prefersReducedMotion = useReducedMotion()

  // A single eligible article is an ordinary static hero: no controls, no timer.
  const rotates = slides.length > 1
  const autoRotating = rotates && !engaged && tabVisible && !prefersReducedMotion

  // Re-armed on every index change, so choosing a slide by hand restarts the
  // dwell time instead of advancing again a moment later. The cleanup clears the
  // pending timer on unmount and makes a second concurrent timer impossible.
  useEffect(() => {
    if (!autoRotating) return
    const timer = setTimeout(() => setIndex((current) => current + 1), ROTATION_MS)
    return () => clearTimeout(timer)
  }, [autoRotating, index])

  useEffect(() => {
    if (!rotates) return
    const sync = () => setTabVisible(document.visibilityState === 'visible')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [rotates])

  if (slides.length === 0) return null

  // The index counts up without bound and is wrapped only here, so the rotation
  // loops and a shrinking `slides` array (an article unpublished between two
  // server renders) can never index past the end.
  const activeIndex = ((index % slides.length) + slides.length) % slides.length
  const active = slides[activeIndex]
  const step = (offset: number) => setIndex(activeIndex + offset)

  return (
    <div
      className="overflow-hidden group card-hover transition-[transform,box-shadow] duration-150 ease-out"
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      // Clicking a control focuses it too, and a focus that outlived the click
      // would hold the rotation for good. Only keyboard focus counts here — a
      // pointer user is already covered by hover, and rotation resumes for them
      // as soon as the pointer leaves.
      onFocusCapture={(event) => {
        if (event.target.matches(':focus-visible')) setEngaged(true)
      }}
      onBlurCapture={() => setEngaged(false)}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* Image */}
        <div className="relative h-64 lg:h-auto lg:min-h-[400px] bg-navy-light overflow-hidden">
          {/* Every cover stays mounted and crossfades, so returning to a slide
              never re-fetches its image or flashes an empty frame. */}
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              aria-hidden={i !== activeIndex}
              style={CROSSFADE}
              className={`absolute inset-0 ${i === activeIndex ? 'opacity-100' : 'opacity-0'}`}
            >
              {slide.coverImage ? (
                <BlurImage
                  src={slide.coverImage}
                  alt={slide.title}
                  fill
                  className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
                  priority={i === 0}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy-light to-navy flex items-center justify-center">
                  <span
                    className="text-gold/15 text-8xl font-bold select-none"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    TC
                  </span>
                </div>
              )}
            </div>
          ))}
          {/* Top row: category badge + read time */}
          <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between">
            {active.categoryName ? (
              <span className="category-badge">{active.categoryName}</span>
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="flex items-center gap-1 bg-navy/70 text-cream/90 text-[10px] font-semibold px-2 py-1 backdrop-blur-sm leading-none">
              <Clock size={9} className="shrink-0" />
              {active.readTime}
            </span>
          </div>
          {/* Gradient overlay bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-navy/30 via-transparent to-transparent pointer-events-none" />

          {/* Rotation controls — same navy/gold chip language as the read-time
              badge above, tucked into the image so they never crowd the
              headline. */}
          {rotates && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center bg-navy/70 backdrop-blur-sm px-1 py-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous featured article"
                className="flex h-6 w-6 items-center justify-center text-cream/70 hover:text-gold transition-colors duration-150"
              >
                <ChevronLeft size={14} />
              </button>
              {slides.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Featured article ${i + 1} of ${slides.length}: ${slide.title}`}
                  aria-current={i === activeIndex}
                  className="group/dot flex h-6 w-6 items-center justify-center"
                >
                  <span
                    className={`block h-1.5 w-1.5 rounded-full transition-colors duration-150 ${
                      i === activeIndex ? 'bg-gold' : 'bg-cream/40 group-hover/dot:bg-cream/80'
                    }`}
                  />
                </button>
              ))}
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next featured article"
                className="flex h-6 w-6 items-center justify-center text-cream/70 hover:text-gold transition-colors duration-150"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-8 lg:p-12 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-[var(--border)]">
          <div className="text-gold/50 text-[0.65rem] tracking-[0.3em] uppercase mb-3 font-semibold">
            Featured
          </div>
          {/* Stacked in one grid cell: the block is as tall as the longest
              article, so advancing never changes the hero's height and nothing
              below it moves. Inactive slides are inert and hidden from the
              accessibility tree, leaving the active article as the only hero
              content a reader or crawler is offered. */}
          <div className="grid">
            {slides.map((slide, i) => (
              <div
                key={slide.id}
                aria-hidden={i !== activeIndex}
                inert={i !== activeIndex}
                style={CROSSFADE}
                className={`col-start-1 row-start-1 ${
                  i === activeIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <Link href={`/articles/${slide.slug}`}>
                  <h2
                    className="text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4 leading-tight transition-colors duration-200 hover:text-gold"
                    style={{ fontFamily: 'var(--font-serif)' }}
                  >
                    {slide.title}
                  </h2>
                </Link>
                {slide.excerpt && (
                  <p className="text-[var(--fg-muted)] text-base leading-relaxed mb-6">
                    {slide.excerpt}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-[var(--fg-faint)] mb-7">
                  <span className="font-semibold text-[var(--fg-muted)]">{slide.authorName}</span>
                  <span className="text-gold/40">·</span>
                  <span>{slide.dateLabel}</span>
                </div>
                <Link
                  href={`/articles/${slide.slug}`}
                  className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest group/link hover:gap-3 transition-[gap] duration-200 ease-out"
                >
                  Read Article
                  <span className="inline-block transition-transform duration-200 ease-out group-hover/link:translate-x-1">
                    →
                  </span>
                </Link>
              </div>
            ))}
          </div>
          {/* Announced only while the hero is not advancing on its own, so a
              screen reader hears deliberate navigation and is never interrupted
              by the timer. */}
          {rotates && (
            <p className="sr-only" aria-live={autoRotating ? 'off' : 'polite'}>
              {`Featured article ${activeIndex + 1} of ${slides.length}: ${active.title}`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
