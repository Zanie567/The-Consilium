import { ContactForm } from '@/components/ui/ContactForm'
import { Mail, MapPin } from 'lucide-react'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'
import { AnimateIn } from '@/components/ui/AnimateIn'
import { CONTACT_EMAIL, INSTAGRAM_URL, LINKEDIN_URL } from '@/lib/constants'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with The Consilium editorial team.',
  alternates: canonicalAlternates('/contact'),
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/>
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
      <rect x="2" y="9" width="4" height="12"/>
      <circle cx="4" cy="4" r="2"/>
    </svg>
  )
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <AnimateIn variant="fade-in" duration={0.4}>
          <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">
            Get In Touch
          </p>
        </AnimateIn>
        <AnimateIn variant="fade-up" delay={0.08} duration={0.6}>
          <h1
            className="text-4xl sm:text-5xl font-bold text-gold"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Contact
          </h1>
        </AnimateIn>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
          {/* Info column */}
          <AnimateIn variant="fade-left" delay={0.1} duration={0.55} className="lg:col-span-2">
            <h2
              className="text-xl font-bold text-[var(--fg)] mb-4"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              We&apos;d love to hear from you
            </h2>
            <p className="text-[var(--fg-muted)] text-sm leading-relaxed mb-8">
              Whether you&apos;re interested in writing for us, have a story tip, or
              want to collaborate with the Edinburgh Economics Society, please
              reach out.
            </p>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Mail size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-1">
                    Email
                  </p>
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-[var(--fg-muted)] text-sm hover:text-gold transition-colors"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-1">
                    Location
                  </p>
                  <p className="text-[var(--fg-muted)] text-sm">
                    University of Edinburgh<br />
                    Edinburgh, Scotland
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <p className="text-[var(--fg)] text-xs font-bold uppercase tracking-widest mb-3">
                Follow Us
              </p>
              <div className="flex gap-3">
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow The Consilium on Instagram"
                  className="w-9 h-9 border border-[var(--border)] flex items-center justify-center text-[var(--fg-faint)] hover:bg-navy hover:text-gold hover:border-navy transition-colors"
                >
                  <InstagramIcon />
                </a>
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Connect with The Consilium on LinkedIn"
                  className="w-9 h-9 border border-[var(--border)] flex items-center justify-center text-[var(--fg-faint)] hover:bg-navy hover:text-gold hover:border-navy transition-colors"
                >
                  <LinkedInIcon />
                </a>
              </div>
            </div>
          </AnimateIn>

          {/* Form column */}
          <AnimateIn variant="fade-right" delay={0.18} duration={0.55} className="lg:col-span-3">
            <ContactForm />
          </AnimateIn>
        </div>
      </div>
    </div>
  )
}
