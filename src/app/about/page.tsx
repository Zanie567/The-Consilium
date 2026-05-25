import type { Metadata } from 'next'
import Link from 'next/link'
import { AnimateIn, StaggerContainer, StaggerItem } from '@/components/ui/AnimateIn'

export const metadata: Metadata = {
  title: 'About',
  description:
    'Learn about The Consilium, the official publication of the University of Edinburgh Economics Society.',
}

const sections = [
  {
    title: 'News',
    description:
      'Current economic events and policy developments, explained with clarity and depth.',
  },
  {
    title: 'Opinion',
    description:
      'Thoughtful commentary and argument from our writers on economic and political questions.',
  },
  {
    title: 'Analysis',
    description:
      'In-depth analytical pieces examining economic trends, data, and theoretical questions.',
  },
  {
    title: 'Interviews',
    description:
      'Conversations with economists, policymakers, academics, and practitioners.',
  },
]

const values = [
  {
    title: 'Intellectual Rigour',
    desc: 'We hold our work to the standards of academic economics, grounded in evidence and sound argument.',
  },
  {
    title: 'Editorial Independence',
    desc: 'The Consilium operates independently and is not subject to influence from external parties.',
  },
  {
    title: 'Diverse Perspectives',
    desc: 'We welcome a range of views across the political and methodological spectrum of economic thought.',
  },
  {
    title: 'Accessibility',
    desc: 'We strive to make complex economic ideas accessible without sacrificing accuracy or nuance.',
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-16 px-4 border-b border-gold/25 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, #c9a227 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <AnimateIn variant="fade-in" duration={0.4}>
            <p className="text-gold/60 text-[0.65rem] tracking-[0.4em] uppercase mb-3 font-semibold">
              The Consilium
            </p>
          </AnimateIn>
          <AnimateIn variant="fade-up" delay={0.07} duration={0.65}>
            <h1
              className="text-4xl sm:text-5xl font-bold text-gold mb-4"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              About
            </h1>
          </AnimateIn>
          <AnimateIn variant="fade-in" delay={0.16} duration={0.55}>
            <p className="text-cream/60 text-sm max-w-xl mx-auto">
              The official publication of the University of Edinburgh Economics Society
            </p>
          </AnimateIn>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Mission */}
        <AnimateIn variant="fade-up" className="mb-14">
          <div className="w-10 h-[2px] bg-gold mb-7" />
          <h2
            className="text-2xl font-bold text-[var(--fg)] mb-5"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Our Mission
          </h2>
          <div className="space-y-4 text-[var(--fg-muted)] text-base leading-relaxed">
            <p>
              The Consilium exists to provide a platform for rigorous economic thought at the
              University of Edinburgh. We believe that economics is not merely an academic
              discipline, but a lens through which to understand the forces that shape our world
              from global financial markets to local policy decisions.
            </p>
            <p>
              Founded by the University of Edinburgh Economics Society, we are committed to
              editorial independence, intellectual honesty, and the highest standards of
              analytical journalism. Our writers are students bringing fresh perspectives to The Consilium.
            </p>
            <p>
              The name <em>Consilium </em> is Latin for &ldquo;council&rdquo; or
              &ldquo;deliberation&rdquo;, and reflects our belief in the power of informed debate.
              We do not seek to impose a single viewpoint, but to illuminate the complexity of
              economic questions and foster thoughtful discourse.
            </p>
          </div>
        </AnimateIn>

        <div className="h-px bg-[var(--border)] my-12" />

        {/* What we publish */}
        <AnimateIn variant="fade-up" className="mb-14">
          <h2
            className="text-2xl font-bold text-[var(--fg)] mb-8"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            What We Publish
          </h2>
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4 auto-rows-fr">
            {sections.map((section) => (
              <StaggerItem key={section.title} className="h-full">
                <div className="h-full p-6 border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-gold/40 transition-colors duration-200 card-hover">
                  <h3 className="text-[0.65rem] font-bold uppercase tracking-widest text-gold mb-2.5">
                    {section.title}
                  </h3>
                  <p className="text-[var(--fg-muted)] text-sm leading-relaxed">
                    {section.description}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </AnimateIn>

        <div className="h-px bg-[var(--border)] my-12" />

        {/* Values */}
        <AnimateIn variant="fade-up" className="mb-14">
          <h2
            className="text-2xl font-bold text-[var(--fg)] mb-8"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Our Values
          </h2>
          <StaggerContainer className="space-y-5">
            {values.map((val) => (
              <StaggerItem key={val.title}>
                <div className="flex gap-5">
                  <div className="w-[3px] self-stretch bg-gold/30 rounded-full shrink-0 mt-1" />
                  <div>
                    <span className="font-semibold text-[var(--fg)] text-sm">{val.title}. </span>
                    <span className="text-[var(--fg-muted)] text-sm">{val.desc}</span>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </AnimateIn>

        <div className="h-px bg-[var(--border)] my-12" />

        {/* CTA */}
        <AnimateIn variant="fade-up" className="text-center">
          <p className="text-[var(--fg-muted)] text-base mb-8">
            Interested in contributing to The Consilium, or want to get in touch?
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="inline-block bg-navy text-gold px-10 py-3.5 text-xs font-bold uppercase tracking-widest hover:bg-navy-dark transition-all duration-200 btn-lift"
            >
              Contact Us
            </Link>
            <Link
              href="/team"
              className="inline-block border border-[var(--fg)] text-[var(--fg)] px-10 py-3.5 text-xs font-bold uppercase tracking-widest hover:bg-navy hover:text-gold hover:border-navy transition-all duration-200 btn-lift"
            >
              Meet the Team
            </Link>
          </div>
        </AnimateIn>
      </div>
    </div>
  )
}
