import Link from 'next/link'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'
import { CONTACT_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing use of The Consilium website.',
  alternates: canonicalAlternates('/terms'),
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-12 pb-8 border-b border-[var(--border)]">
          <p className="text-gold text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-4">
            Legal
          </p>
          <h1
            className="text-4xl sm:text-5xl font-bold text-[var(--fg)] leading-tight mb-5"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Terms of Service
          </h1>
          <p className="text-[var(--fg-muted)] text-lg leading-relaxed">
            These are the terms for using The Consilium. They are short and written in plain
            English. By using the site, you are agreeing to them.
          </p>
          <p className="text-[var(--fg-faint)] text-sm mt-4">Last updated: 7 April 2026</p>
        </div>

        <div className="prose-consilium space-y-10">

          <section>
            <h2>What The Consilium is</h2>
            <p>
              The Consilium is the student publication of the University of Edinburgh Economics
              Society. Everything published here is written by students and is intended for
              educational and informational purposes. We are not affiliated with or funded by
              the University, and we operate on a not-for-profit basis.
            </p>
          </section>

          <section>
            <h2>How you may use the site</h2>
            <p>
              You are welcome to read, share links to, and quote briefly from articles on The
              Consilium, provided the source is clearly credited. Please do not reproduce or
              republish articles in full without the written permission of the author and the
              editorial team.
            </p>
            <p>
              You may not use the site for anything unlawful, attempt to access parts of it you
              are not authorised to access, or systematically scrape its content. We reserve the
              right to remove access for anyone who misuses the site.
            </p>
          </section>

          <section>
            <h2>Content and ownership</h2>
            <p>
              Articles belong to their authors. The Consilium name, logo, and branding belong
              to the University of Edinburgh Economics Society. If you contribute an article for
              publication, you keep ownership of your work and grant us a licence to publish it
              on this website.
            </p>
            <p>
              We may edit, correct, or remove any content where we consider it necessary.
              Significant changes to published articles are handled according to our{' '}
              <Link href="/corrections" className="text-gold hover:underline">
                Corrections Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2>Not financial advice</h2>
            <p>
              Nothing on this site is financial, investment, legal, or professional advice.
              The articles here are student opinion and analysis, and should be read as such.
              Opinions expressed belong to individual authors and do not represent the
              University of Edinburgh, the Economics Society, or The Consilium as an institution.
            </p>
          </section>

          <section>
            <h2>Accuracy and availability</h2>
            <p>
              We work hard to publish accurate, well-researched content, but we cannot guarantee
              that everything on the site is complete or error-free. We are also not able to
              promise the site will be available at all times. Use the content here as one input
              among many, not as a definitive source.
            </p>
          </section>

          <section>
            <h2>Changes and questions</h2>
            <p>
              We may update these terms occasionally. The date at the top of the page will reflect
              the most recent revision. If you have any questions, please get in touch at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <p>
              These terms are governed by the laws of Scotland. You may also want to read our{' '}
              <Link href="/privacy" className="text-gold hover:underline">
                Privacy Policy
              </Link>
              , which explains how we handle any personal data.
            </p>
          </section>

        </div>

        <div className="mt-14 pt-8 border-t border-[var(--border)]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gold text-xs font-bold uppercase tracking-widest hover:gap-3 transition-all duration-200 group"
          >
            <span className="transition-transform duration-200 group-hover:-translate-x-1">&larr;</span>
            Back to Homepage
          </Link>
        </div>
      </div>
    </div>
  )
}
