// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react'
import { FeaturedArticleHero, type HeroSlide } from '@/components/ui/FeaturedArticleHero'

/**
 * Behaviour of the rotating hero, driven through the DOM a reader actually
 * gets: what is on screen, what the controls do, and what the timer does.
 *
 * next/image needs the framework's build pipeline, so the image wrapper is
 * swapped for a plain <img>. Nothing below asserts on image internals — only
 * that the picture on screen belongs to the same article as the headline.
 */
vi.mock('@/components/ui/BlurImage', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test stub, not a rendered page
  BlurImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

/**
 * framer-motion resolves the reduced-motion media query once per module, so a
 * per-test matchMedia stub would never be read after the first render. The hook
 * itself is the seam instead.
 */
let prefersReducedMotion = false
vi.mock('framer-motion', () => ({ useReducedMotion: () => prefersReducedMotion }))

const slide = (n: number): HeroSlide => ({
  id: `id-${n}`,
  slug: `article-${n}`,
  title: `Headline ${n}`,
  excerpt: `Excerpt ${n}`,
  coverImage: `/cover-${n}.jpg`,
  categoryName: `Category ${n}`,
  readTime: `${n} min read`,
  authorName: `Author ${n}`,
  dateLabel: `${n} September 2026`,
})

const THREE = [slide(1), slide(2), slide(3)]
const ROTATION_MS = 7500

/**
 * The hero keeps every slide mounted, but inactive ones are aria-hidden and
 * inert — so a role query, which skips inaccessible subtrees, resolves to
 * exactly the slide the reader is being shown.
 */
function activeSlide() {
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings).toHaveLength(1)
  return headings[0].closest('div[class*="col-start-1"]') as HTMLElement
}

/** Counts the rotation timer specifically, ignoring unrelated jsdom/React timers. */
function rotationTimers() {
  const set = vi.spyOn(globalThis, 'setTimeout')
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  return {
    get scheduled() {
      return set.mock.calls.filter((call) => call[1] === ROTATION_MS).length
    },
    get pending() {
      const ours = set.mock.calls
        .map((call, i) => (call[1] === ROTATION_MS ? set.mock.results[i].value : undefined))
        .filter((id) => id !== undefined)
      const cleared = new Set(clear.mock.calls.map((call) => call[0]))
      return ours.filter((id) => !cleared.has(id)).length
    },
  }
}

const activeHeadline = () => activeSlide().querySelector('h2')!.textContent

/** Advance past one dwell period. */
const tick = (ms = ROTATION_MS) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  prefersReducedMotion = false
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('initial render', () => {
  it('shows the first article, deterministically', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('renders the first headline into the markup for crawlers', () => {
    const { container } = render(<FeaturedArticleHero slides={THREE} />)
    expect(container.innerHTML).toContain('Headline 1')
  })

  it('titles every slide with an h2, leaving the page h1 uncontested', () => {
    const { container } = render(<FeaturedArticleHero slides={THREE} />)
    expect(container.querySelectorAll('h2')).toHaveLength(3)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('exposes only the active article to the accessibility tree', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    // All three slides are in the DOM, but the inactive two are aria-hidden and
    // inert — so exactly one headline and one "Read Article" link are reachable.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /read article/i })).toHaveLength(1)
  })
})

describe('automatic rotation', () => {
  it('advances to the next article after the dwell time', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    expect(activeHeadline()).toBe('Headline 1')
    tick()
    expect(activeHeadline()).toBe('Headline 2')
  })

  it('does not advance early', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    tick(ROTATION_MS - 500)
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('loops back to the first article after the last', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    tick()
    tick()
    expect(activeHeadline()).toBe('Headline 3')
    tick()
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('keeps looping in the same order — it never jumps around', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    const seen: (string | null)[] = [activeHeadline()]
    for (let i = 0; i < 5; i++) {
      tick()
      seen.push(activeHeadline())
    }
    expect(seen).toEqual([
      'Headline 1', 'Headline 2', 'Headline 3',
      'Headline 1', 'Headline 2', 'Headline 3',
    ])
  })
})

describe('manual controls', () => {
  it('advances with Next', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next featured article' }))
    expect(activeHeadline()).toBe('Headline 2')
  })

  it('goes back with Previous, wrapping to the last article', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous featured article' }))
    expect(activeHeadline()).toBe('Headline 3')
  })

  it('jumps straight to an article from its pagination control', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Featured article 3 of 3: Headline 3' }),
    )
    expect(activeHeadline()).toBe('Headline 3')
  })

  it('marks the current position', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    const dot = screen.getByRole('button', { name: 'Featured article 1 of 3: Headline 1' })
    expect(dot.getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Next featured article' }))
    expect(dot.getAttribute('aria-current')).toBe('false')
    expect(
      screen
        .getByRole('button', { name: 'Featured article 2 of 3: Headline 2' })
        .getAttribute('aria-current'),
    ).toBe('true')
  })

  it('names its controls without relying on the icons', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    expect(screen.getByRole('button', { name: 'Previous featured article' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next featured article' })).toBeTruthy()
  })

  it('restarts the dwell time instead of advancing again straight away', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    // Nearly a full period has elapsed when the reader steps forward by hand.
    tick(ROTATION_MS - 200)
    fireEvent.click(screen.getByRole('button', { name: 'Next featured article' }))
    expect(activeHeadline()).toBe('Headline 2')
    // The 200ms that remained on the old timer must not carry over.
    tick(ROTATION_MS - 200)
    expect(activeHeadline()).toBe('Headline 2')
    tick(200)
    expect(activeHeadline()).toBe('Headline 3')
  })
})

describe('pausing while the reader is engaged', () => {
  it('stops advancing on hover and resumes when the pointer leaves', () => {
    const { container } = render(<FeaturedArticleHero slides={THREE} />)
    const hero = container.firstElementChild as HTMLElement

    fireEvent.mouseEnter(hero)
    tick(ROTATION_MS * 3)
    expect(activeHeadline()).toBe('Headline 1')

    fireEvent.mouseLeave(hero)
    tick()
    expect(activeHeadline()).toBe('Headline 2')
  })

  it('stops advancing while a control has keyboard focus', () => {
    // jsdom implements no :focus-visible, so stand in for it: the focused
    // element is the keyboard-focused one.
    const matches = Element.prototype.matches
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (
      this: HTMLElement,
      selector: string,
    ) {
      return selector === ':focus-visible'
        ? this === document.activeElement
        : matches.call(this, selector)
    })

    render(<FeaturedArticleHero slides={THREE} />)
    const next = screen.getByRole('button', { name: 'Next featured article' })

    act(() => next.focus())
    tick(ROTATION_MS * 2)
    expect(activeHeadline()).toBe('Headline 1')

    act(() => next.blur())
    tick()
    expect(activeHeadline()).toBe('Headline 2')
  })

  it('keeps rotating after a control is clicked, rather than freezing on it', () => {
    // A click leaves the button focused. If that counted as engagement the hero
    // would never advance again once a reader touched the controls.
    render(<FeaturedArticleHero slides={THREE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next featured article' }))
    expect(activeHeadline()).toBe('Headline 2')
    tick()
    expect(activeHeadline()).toBe('Headline 3')
  })

  it('gives a full dwell period after the reader disengages', () => {
    const { container } = render(<FeaturedArticleHero slides={THREE} />)
    const hero = container.firstElementChild as HTMLElement
    tick(ROTATION_MS - 100)
    fireEvent.mouseEnter(hero)
    fireEvent.mouseLeave(hero)
    tick(ROTATION_MS - 100)
    expect(activeHeadline()).toBe('Headline 1')
    tick(100)
    expect(activeHeadline()).toBe('Headline 2')
  })

  it('stops advancing while the tab is hidden', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    tick(ROTATION_MS * 3)
    expect(activeHeadline()).toBe('Headline 1')

    visibility.mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    tick()
    expect(activeHeadline()).toBe('Headline 2')
    visibility.mockRestore()
  })
})

describe('reduced motion', () => {
  it('does not auto-rotate', () => {
    prefersReducedMotion = true
    render(<FeaturedArticleHero slides={THREE} />)
    tick(ROTATION_MS * 5)
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('still lets the reader navigate by hand', () => {
    prefersReducedMotion = true
    render(<FeaturedArticleHero slides={THREE} />)
    expect(screen.getByRole('button', { name: 'Next featured article' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next featured article' }))
    expect(activeHeadline()).toBe('Headline 2')
    fireEvent.click(screen.getByRole('button', { name: 'Previous featured article' }))
    expect(activeHeadline()).toBe('Headline 1')
  })
})

describe('a single eligible article', () => {
  it('renders a static hero with no controls', () => {
    render(<FeaturedArticleHero slides={[slide(1)]} />)
    expect(activeHeadline()).toBe('Headline 1')
    expect(screen.queryByRole('button', { name: 'Next featured article' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous featured article' })).toBeNull()
  })

  it('starts no timer', () => {
    const timers = rotationTimers()
    render(<FeaturedArticleHero slides={[slide(1)]} />)
    expect(timers.scheduled).toBe(0)
    tick(ROTATION_MS * 3)
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('rotates as soon as there are two', () => {
    render(<FeaturedArticleHero slides={[slide(1), slide(2)]} />)
    expect(screen.getByRole('button', { name: 'Next featured article' })).toBeTruthy()
    tick()
    expect(activeHeadline()).toBe('Headline 2')
    tick()
    expect(activeHeadline()).toBe('Headline 1')
  })
})

describe('each state is one coherent article', () => {
  it('moves image, category, read time, headline, excerpt, byline, date and link together', () => {
    render(<FeaturedArticleHero slides={THREE} />)

    for (const n of [1, 2, 3]) {
      const active = activeSlide()
      // Image, category and read time live in the picture column, outside the
      // text block, so they are checked against the whole hero.
      const image = screen.getByAltText(`Headline ${n}`)
      expect(image.closest('[aria-hidden]')!.getAttribute('aria-hidden')).toBe('false')
      expect(screen.getByText(`Category ${n}`)).toBeTruthy()
      expect(screen.getByText(`${n} min read`)).toBeTruthy()

      expect(active.querySelector('h2')!.textContent).toBe(`Headline ${n}`)
      expect(within(active).getByText(`Excerpt ${n}`)).toBeTruthy()
      expect(within(active).getByText(`Author ${n}`)).toBeTruthy()
      expect(within(active).getByText(`${n} September 2026`)).toBeTruthy()

      for (const link of within(active).getAllByRole('link')) {
        expect(link.getAttribute('href')).toBe(`/articles/article-${n}`)
      }
      tick()
    }
  })

  it('never shows one article\'s picture beside another\'s headline', () => {
    render(<FeaturedArticleHero slides={THREE} />)
    for (let i = 0; i < 4; i++) {
      const headline = activeHeadline()!
      // Exactly one category badge and one visible cover exist at any moment,
      // and both must name the same article as the headline.
      const category = screen.getAllByText(/^Category \d$/)
      expect(category).toHaveLength(1)
      const shown = screen
        .getAllByRole('img', { hidden: true })
        .filter((img) => img.closest('[aria-hidden]')!.getAttribute('aria-hidden') === 'false')
      expect(shown).toHaveLength(1)
      const n = headline.slice(-1)
      expect(category[0].textContent).toBe(`Category ${n}`)
      expect(shown[0].getAttribute('alt')).toBe(`Headline ${n}`)
      tick()
    }
  })
})

describe('timer hygiene', () => {
  it('leaves no timer behind on unmount', () => {
    const timers = rotationTimers()
    const { unmount } = render(<FeaturedArticleHero slides={THREE} />)
    expect(timers.pending).toBe(1)
    unmount()
    expect(timers.pending).toBe(0)
  })

  it('never runs two timers at once, however much the reader clicks', () => {
    const timers = rotationTimers()
    render(<FeaturedArticleHero slides={THREE} />)
    const next = screen.getByRole('button', { name: 'Next featured article' })
    for (let i = 0; i < 10; i++) {
      fireEvent.click(next)
      expect(timers.pending).toBe(1)
    }
    tick(ROTATION_MS * 4)
    expect(timers.pending).toBe(1)
  })
})

describe('optional fields', () => {
  it('omits a missing excerpt without breaking the slide', () => {
    render(<FeaturedArticleHero slides={[{ ...slide(1), excerpt: null }, slide(2)]} />)
    expect(activeHeadline()).toBe('Headline 1')
    expect(screen.queryByText('Excerpt 1')).toBeNull()
    tick()
    expect(screen.getByText('Excerpt 2')).toBeTruthy()
  })

  it('falls back to the wordmark when an article has no cover image', () => {
    render(<FeaturedArticleHero slides={[{ ...slide(1), coverImage: null }, slide(2)]} />)
    expect(screen.queryByAltText('Headline 1')).toBeNull()
    expect(screen.getAllByText('TC')).toHaveLength(1)
    expect(activeHeadline()).toBe('Headline 1')
  })

  it('renders without a category', () => {
    render(<FeaturedArticleHero slides={[{ ...slide(1), categoryName: null }, slide(2)]} />)
    expect(screen.queryByText('Category 1')).toBeNull()
    expect(activeHeadline()).toBe('Headline 1')
  })
})
