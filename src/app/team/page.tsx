import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'
import { TeamMemberCard } from '@/components/team/TeamMemberCard'
import { buildTeamMasthead } from '@/lib/teamHierarchy'
import { canonicalAlternates } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Our Team',
  description: 'Meet the team behind The Consilium, the publication of the University of Edinburgh Economics Society.',
  alternates: canonicalAlternates('/team'),
}

async function getTeamMembers() {
  try {
    return await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
  } catch {
    return []
  }
}

export default async function TeamPage() {
  const members = await getTeamMembers()
  // Tiers are derived from each member's free-text role, so a person added
  // through /admin/team is placed without any code change here.
  const sections = buildTeamMasthead(members)

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <AnimateIn variant="fade-in" duration={0.4}>
          <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">The Consilium</p>
        </AnimateIn>
        <AnimateIn variant="fade-up" delay={0.08} duration={0.6}>
          <h1
            className="text-4xl sm:text-5xl font-bold text-gold mb-4"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Our Team
          </h1>
        </AnimateIn>
        <AnimateIn variant="fade-in" delay={0.18} duration={0.5}>
          <p className="text-cream/60 text-sm max-w-xl mx-auto">
            The students and society members who produce The Consilium
          </p>
        </AnimateIn>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        {sections.length > 0 ? (
          sections.map((section, sectionIndex) => (
            <section
              key={section.id}
              aria-labelledby={`team-${section.id}`}
              className={sectionIndex > 0 ? 'mt-14 sm:mt-20' : ''}
            >
              {section.labelVisible ? (
                <AnimateIn variant="fade-in" duration={0.4}>
                  <div className="flex items-center gap-5 mb-9 sm:mb-11">
                    <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-strong)]" />
                    <h2
                      id={`team-${section.id}`}
                      className="text-[0.7rem] font-bold uppercase tracking-[0.3em] text-[var(--fg-faint)]"
                    >
                      {section.label}
                    </h2>
                    <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-strong)]" />
                  </div>
                </AnimateIn>
              ) : (
                <h2 id={`team-${section.id}`} className="sr-only">
                  {section.label}
                </h2>
              )}

              {section.rows.map((row, rowIndex) => (
                <StaggerContainer
                  key={row.tier}
                  className={`flex flex-wrap justify-center gap-5 sm:gap-6 ${
                    rowIndex > 0 ? 'mt-6 sm:mt-8' : ''
                  }`}
                  staggerDelay={0.06}
                  delayChildren={0.04}
                >
                  {row.members.map((member) => (
                    <StaggerItem key={member.id} className="w-full sm:w-auto">
                      <TeamMemberCard member={member} variant={row.variant} />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              ))}
            </section>
          ))
        ) : (
          <AnimateIn variant="fade-up" className="py-24 text-center">
            <p
              className="text-4xl font-bold text-[var(--fg-faint)] mb-3"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Team information coming soon
            </p>
            <p className="text-[var(--fg-faint)] text-sm">
              Our team profiles will be published shortly.
            </p>
          </AnimateIn>
        )}
      </div>
    </div>
  )
}
