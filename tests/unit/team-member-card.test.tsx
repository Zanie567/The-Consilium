// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TeamMemberCard, type TeamCardMember } from '@/components/team/TeamMemberCard'

// next/image needs the framework pipeline; a plain <img> is enough to see whether
// an image was rendered at all.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test stub
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

afterEach(cleanup)

const member = (overrides: Partial<TeamCardMember> = {}): TeamCardMember => ({
  id: 'm1',
  name: 'Sam Hunt',
  role: null,
  bio: null,
  image: null,
  email: null,
  authorSlug: null,
  ...overrides,
})

describe('TeamMemberCard', () => {
  it('renders initials instead of a photo when there is no image', () => {
    const { container } = render(<TeamMemberCard member={member()} variant="compact" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('SH')).toBeTruthy()
  })

  it('renders the photo when there is one', () => {
    const { container } = render(
      <TeamMemberCard member={member({ image: 'https://x.test/a.png' })} variant="compact" />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.test/a.png')
  })

  it('shows a bio as plain text — markup in it is not interpreted', () => {
    const { container } = render(
      <TeamMemberCard member={member({ bio: '<img src=x onerror=alert(1)>hi' })} variant="compact" />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>hi')
  })
})
