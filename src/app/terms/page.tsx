import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing use of The Consilium website.',
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
            By using The Consilium website, you agree to these terms. Please read them; they are
            straightforward and written in plain English.
          </p>
          <p className="text-[var(--fg-faint)] text-sm mt-4">Last updated: 6 April 2026</p>
        </div>

        <div className="prose-consilium space-y-10">

          <section>
            <h2>About The Consilium</h2>
            <p>
              The Consilium is the official student publication of the University of Edinburgh
              Economics Society. We publish economics analysis, opinion pieces, and commentary
              written by students at the University of Edinburgh. The website is run on a
              not-for-profit basis and is independent of the University.
            </p>
          </section>

          <section>
            <h2>Acceptance of these terms</h2>
            <p>
              By accessing or using this website, you agree to be bound by these terms. If you do
              not agree, please do not use the website. These terms apply to all visitors, readers,
              and account holders.
            </p>
          </section>

          <section>
            <h2>Acceptable use</h2>
            <p>You may use this website for lawful purposes only. You must not:</p>
            <ul>
              <li>Use the site for any unlawful purpose or in a way that violates any applicable law</li>
              <li>Attempt to gain unauthorised access to any part of the site or its systems</li>
              <li>Transmit spam, malware, or any harmful code through the site</li>
              <li>
                Scrape or systematically download content from the site in bulk without our
                written permission
              </li>
              <li>
                Impersonate The Consilium, its editors, or any other person in a way that is
                misleading or deceptive
              </li>
              <li>
                Use the site to harass, threaten, or intimidate any individual
              </li>
            </ul>
            <p>
              We reserve the right to suspend or terminate access to the website for anyone who
              violates these terms.
            </p>
          </section>

          <section>
            <h2>Content and intellectual property</h2>
            <p>
              All articles, analysis, opinion pieces, and other original content published on The
              Consilium belong to their respective authors. The Consilium name, logo, and
              branding are the property of the University of Edinburgh Economics Society.
            </p>
            <p>
              You are welcome to share links to articles on The Consilium. However, you may not
              reproduce, republish, or distribute articles in full without the explicit written
              permission of the author and The Consilium. Brief quotations for the purpose of
              commentary or criticism are permitted provided the source is clearly attributed.
            </p>
            <p>
              If you submit content to The Consilium for publication, you grant us a non-exclusive
              licence to publish that content on the website and in any associated materials. You
              retain ownership of your work.
            </p>
          </section>

          <section>
            <h2>Our right to remove or amend content</h2>
            <p>
              The Consilium reserves the right to edit, correct, or remove any content published
              on the website, including articles, comments, and user submissions. We may do so
              where content is factually inaccurate, misleading, unlawful, or contrary to our
              editorial standards.
            </p>
            <p>
              Where content is removed or significantly amended, we will follow our{' '}
              <Link href="/corrections" className="text-gold hover:underline">
                Corrections Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2>No financial or investment advice</h2>
            <p>
              The content published on The Consilium is for educational and informational purposes
              only. Nothing on this website constitutes financial, investment, legal, tax, or
              professional advice of any kind. Do not make financial decisions based solely on
              what you read here.
            </p>
            <p>
              Opinions expressed in articles are those of the individual authors and do not
              represent the views of the University of Edinburgh, the University of Edinburgh
              Economics Society, or The Consilium as an institution.
            </p>
          </section>

          <section>
            <h2>No warranties</h2>
            <p>
              The Consilium is provided &ldquo;as is&rdquo;. While we make every effort to ensure
              the accuracy of our content, we make no warranties or guarantees that the information
              published is complete, accurate, or up to date. We are not responsible for any
              errors, omissions, or outcomes arising from your use of information published on
              this site.
            </p>
            <p>
              We do not guarantee that the website will be available at all times or free from
              technical errors.
            </p>
          </section>

          <section>
            <h2>Links to third-party websites</h2>
            <p>
              Our website may contain links to external websites. These are provided for your
              convenience and do not constitute an endorsement of those sites or their content.
              We have no control over, and accept no responsibility for, the content or practices
              of any third-party website.
            </p>
          </section>

          <section>
            <h2>Changes to these terms</h2>
            <p>
              We may update these terms from time to time. When we do, we will update the date at
              the top of this page. Continued use of the website after changes are posted
              constitutes your acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2>Governing law</h2>
            <p>
              These terms are governed by the laws of Scotland and England and Wales. Any disputes
              arising from your use of this website will be subject to the exclusive jurisdiction
              of the courts of Scotland.
            </p>
          </section>

          <section>
            <h2>Contact us</h2>
            <p>
              If you have any questions about these terms, please contact us at{' '}
              <a href="mailto:theconsilium.editor@gmail.com">theconsilium.editor@gmail.com</a>.
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
