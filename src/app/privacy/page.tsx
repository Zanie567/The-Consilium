import Link from 'next/link'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'
import { CONTACT_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How The Consilium collects, uses, and protects your personal data.',
  alternates: canonicalAlternates('/privacy'),
}

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="text-[var(--fg-muted)] text-lg leading-relaxed">
            This policy sets out what data we collect, why we collect it, how long we keep it, and
            what rights you have over it.
          </p>
          <p className="text-[var(--fg-faint)] text-sm mt-4">Last updated: 6 April 2026</p>
        </div>

        <div className="prose-consilium space-y-10">

          <section>
            <h2>Who we are</h2>
            <p>
              The Consilium is the official publication of the University of Edinburgh Economics
              Society. We publish economics analysis, opinion, and commentary written by students.
              We are based in Edinburgh, Scotland, and operate under UK law.
            </p>
            <p>
              If you have any questions about this policy or how we handle your data, please contact
              us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <section>
            <h2>What data we collect and why</h2>
            <p>We only collect information that is necessary to run the website. Here is what we collect:</p>

            <h3>Newsletter subscriptions</h3>
            <p>
              When you subscribe to our newsletter, we store your email address. We use it to send
              you new articles and updates. The legal basis is your consent: you can unsubscribe at
              any time using the link at the bottom of any newsletter email, and we will delete your
              email address immediately.
            </p>

            <h3>Reader accounts</h3>
            <p>
              If you create an account, we store your name, email address, and a securely hashed
              version of your password (we never store passwords in plain text). We use this to let
              you log in, save articles, and track your reading progress across devices. The legal
              basis is your consent at the point of sign-up. You can request deletion of your account
              and all associated data at any time.
            </p>

            <h3>Reading progress and bookmarks</h3>
            <p>
              If you have an account, we store which articles you have read, how far through each
              article you are, and which articles you have bookmarked. This lets you continue reading
              where you left off. This data is linked to your account and is deleted when your account
              is deleted.
            </p>

            <h3>Contact form submissions</h3>
            <p>
              When you use our contact form, we store your name, email address, subject, and message
              so that we can respond to you. We retain contact messages for up to two years. The
              legal basis is our legitimate interest in responding to enquiries.
            </p>

            <h3>Cookies and visit tracking</h3>
            <p>
              We use a small number of cookies. A visit counter cookie helps us decide when
              to show you our account sign-up prompt. A session cookie is used to keep you logged in
              if you have an account. No advertising or tracking cookies are used.
            </p>
            <p>
              When you first visit the site, you will be asked to accept or decline non-essential
              cookies. If you decline, only the essential session cookie will be used. You can change
              your preference at any time by clearing your browser cookies.
            </p>

            <h3>Login records</h3>
            <p>
              We record the time, email address, and IP address of login attempts (both successful
              and failed) for security purposes. This helps us detect unauthorised access attempts
              and protect accounts. This data is visible only to site administrators.
            </p>
          </section>

          <section>
            <h2>How long we keep your data</h2>
            <ul>
              <li><strong>Newsletter subscriptions:</strong> until you unsubscribe</li>
              <li><strong>Account data, reading progress, and bookmarks:</strong> until you delete your account</li>
              <li><strong>Contact form messages:</strong> up to two years</li>
              <li><strong>Login records:</strong> up to one year for security auditing</li>
            </ul>
          </section>

          <section>
            <h2>Where your data is stored</h2>
            <p>
              Your data is stored on a PostgreSQL database hosted by Supabase. Supabase servers
              are located in the European Union. All data is encrypted in transit and at rest.
            </p>
          </section>

          <section>
            <h2>Who we share your data with</h2>
            <p>
              We do not sell your data to anyone, ever. We share it only with the third-party services
              required to operate the website:
            </p>
            <ul>
              <li>
                <strong>Vercel</strong>: hosts the website and serves pages to your browser. Vercel
                processes request data including IP addresses as part of normal web serving.
              </li>
              <li>
                <strong>Supabase</strong>: stores the database containing your account and
                subscription data.
              </li>
              <li>
                <strong>Resend</strong>: sends transactional emails such as password resets and
                account notifications. Your email address is passed to Resend only when sending you
                a message.
              </li>
            </ul>
            <p>
              Each operates under its own privacy policy and, where applicable, UK GDPR.
            </p>
          </section>

          <section>
            <h2>Your rights under UK GDPR</h2>
            <p>
              If you are based in the UK or European Union, you have the following rights regarding
              your personal data:
            </p>
            <ul>
              <li>
                <strong>The right to access:</strong> you can ask us what data we hold about you.
              </li>
              <li>
                <strong>The right to correct:</strong> if any information we hold is inaccurate,
                you can ask us to correct it.
              </li>
              <li>
                <strong>The right to erasure:</strong> you can ask us to delete all personal data
                we hold about you. For account holders, you can do this instantly by contacting us
                or using the deletion option in your account.
              </li>
              <li>
                <strong>The right to withdraw consent:</strong> where we rely on your consent to
                process data (such as newsletter subscriptions), you can withdraw that consent at
                any time. Withdrawing consent does not affect the lawfulness of any processing
                carried out before the withdrawal.
              </li>
              <li>
                <strong>The right to object:</strong> you can object to our use of your data where
                we rely on legitimate interest as the legal basis.
              </li>
            </ul>
            <p>
              To exercise any of these rights, email us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              We will respond within 30 days.
            </p>
            <p>
              If you are unhappy with how we handle your data, you have the right to lodge a
              complaint with the{' '}
              <a
                href="https://ico.org.uk"
                target="_blank"
                rel="noopener noreferrer"
              >
                Information Commissioner&apos;s Office (ICO)
              </a>
              , the UK&apos;s data protection regulator.
            </p>
          </section>

          <section>
            <h2>Changes to this policy</h2>
            <p>
              If we make significant changes to this policy, we will update the date at the top of
              this page. We encourage you to review this policy periodically.
            </p>
          </section>

          <section>
            <h2>Contact us</h2>
            <p>
              For any questions about this privacy policy or your personal data, contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
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
