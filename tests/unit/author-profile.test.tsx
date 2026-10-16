// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  publicTeamCardProfile,
  visibleAuthorProfile,
  type AuthorProfileAccount,
} from '@/lib/teamProfiles'

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  article: { findMany: vi.fn() },
  category: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test stub
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))
vi.mock('@/components/ui/AnimateIn', () => ({
  StaggerContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AnimateIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import AuthorPage, { generateMetadata } from '@/app/author/[slug]/page'

const CARD_PHOTO = 'https://proj.supabase.co/storage/v1/object/public/avatars/u1/team.jpg'
const ACCOUNT_PHOTO = 'https://proj.supabase.co/storage/v1/object/public/avatars/u1/account.jpg'

const card = (overrides: Partial<NonNullable<AuthorProfileAccount['teamProfile']>> = {}) => ({
  name: 'Alexander J. Escala',
  role: 'Editor-in-Chief',
  bio: 'The fuller Meet the Team description.',
  image: CARD_PHOTO,
  isActive: true,
  ...overrides,
})

const account = (overrides: Partial<AuthorProfileAccount> = {}): AuthorProfileAccount => ({
  name: 'Alexander J. Escala',
  email: 'alex@ed.ac.uk',
  bio: 'Short account bio.',
  image: null,
  isActive: true,
  isBanned: false,
  teamProfile: card(),
  ...overrides,
})

const live = { testingMode: false }

describe('visibleAuthorProfile', () => {
  it('uses the public team card description and photo', () => {
    expect(visibleAuthorProfile(account(), live)).toEqual({
      bio: 'The fuller Meet the Team description.',
      image: CARD_PHOTO,
    })
  })

  it('falls back to the account photo when the public card has none', () => {
    const result = visibleAuthorProfile(account({ image: ACCOUNT_PHOTO, teamProfile: card({ image: null }) }), live)
    expect(result).toEqual({ bio: 'The fuller Meet the Team description.', image: ACCOUNT_PHOTO })
  })

  it('returns no photo (initials) when neither the card nor the account has one', () => {
    expect(visibleAuthorProfile(account({ teamProfile: card({ image: '  ' }) }), live).image).toBeNull()
  })

  it('uses the account bio and photo when there is no team card', () => {
    expect(visibleAuthorProfile(account({ image: ACCOUNT_PHOTO, teamProfile: null }), live)).toEqual({
      bio: 'Short account bio.',
      image: ACCOUNT_PHOTO,
    })
  })

  it('never reads a hidden card', () => {
    const hidden = account({ teamProfile: card({ isActive: false, bio: 'Private draft.', image: 'https://proj.supabase.co/x.jpg' }) })
    expect(publicTeamCardProfile(hidden, live)).toBeNull()
    expect(visibleAuthorProfile(hidden, live)).toEqual({ bio: 'Short account bio.', image: null })
  })

  it('never reads a card the roster holds back (incomplete, or an ineligible account)', () => {
    expect(publicTeamCardProfile(account({ teamProfile: card({ bio: ' ' }) }), live)).toBeNull()
    expect(publicTeamCardProfile(account({ teamProfile: card({ role: '' }) }), live)).toBeNull()
    expect(publicTeamCardProfile(account({ isBanned: true }), live)).toBeNull()
    expect(publicTeamCardProfile(account({ isActive: false }), live)).toBeNull()
    expect(publicTeamCardProfile(account({ email: 'test-writer@ed.ac.uk' }), live)).toBeNull()
  })

  it('has no bio when the account bio is blank and there is no public card', () => {
    expect(visibleAuthorProfile(account({ bio: '   ', teamProfile: null }), live).bio).toBeNull()
  })
})

describe('/author/[slug] page', () => {
  const props = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) })
  const row = (overrides: Partial<AuthorProfileAccount> = {}) => ({
    id: 'u1', slug: 'alexander-escala', displayTitles: [], ...account(overrides),
    teamProfile: overrides.teamProfile === null ? null : { publicTier: 'editor_in_chief', ...(overrides.teamProfile ?? card()) },
  })

  beforeEach(() => {
    prismaMock.user.findUnique.mockReset()
    prismaMock.article.findMany.mockReset().mockResolvedValue([])
    prismaMock.category.findMany.mockReset().mockResolvedValue([])
  })
  afterEach(cleanup)

  it('shows the team card photo and description, keeping name and title', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(row())
    render(await AuthorPage(props('alexander-escala')))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Alexander J. Escala')
    expect(screen.getByText('Editor-in-Chief')).toBeTruthy()
    expect(screen.getByText('The fuller Meet the Team description.')).toBeTruthy()
    expect(screen.queryByText('Short account bio.')).toBeNull()
    expect(screen.getByRole('img').getAttribute('src')).toBe(CARD_PHOTO)
    expect(screen.queryByText('AE')).toBeNull()
    expect(screen.getByText('0 published articles')).toBeTruthy()
  })

  it('resolves the same profile through the account-id URL', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row())
    render(await AuthorPage(props('u1')))
    expect(prismaMock.user.findUnique.mock.calls[1][0].where).toEqual({ id: 'u1' })
    expect(screen.getByText('The fuller Meet the Team description.')).toBeTruthy()
  })

  it('shows initials and the account bio for a hidden card', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(row({ teamProfile: card({ isActive: false, bio: 'Hidden text.' }) }))
    render(await AuthorPage(props('alexander-escala')))
    expect(screen.queryByText('Hidden text.')).toBeNull()
    expect(screen.getByText('Short account bio.')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('AE')).toBeTruthy()
  })

  it('reflects an edited team profile on the next request', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ teamProfile: card({ bio: 'Updated description.', image: null }) }))

    render(await AuthorPage(props('alexander-escala')))
    expect(screen.getByText('The fuller Meet the Team description.')).toBeTruthy()
    cleanup()

    render(await AuthorPage(props('alexander-escala')))
    expect(screen.getByText('Updated description.')).toBeTruthy()
    expect(screen.getByText('AE')).toBeTruthy()
  })

  it('uses the same biography for the meta description', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(row())
    const metadata = await generateMetadata(props('alexander-escala'))
    expect(metadata.description).toBe('The fuller Meet the Team description.')
  })
})
