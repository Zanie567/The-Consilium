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
          <p className="text-[var(--fg-faint)] text-sm mt-4">Last updated: 27 October 2026</p>
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
              us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <section>
            <h2>What data we collect and why</h2>
            <p>
              We only collect information that is necessary to run the website. Here is what we
              collect:
            </p>

            <h3 id="newsletter">Newsletter subscriptions</h3>
            <p>
              Our newsletter is The Weekly Edition, sent on Fridays with the articles we published that
              week. You can also choose to receive occasional special-article alerts; these are off
              unless you tick the box, and we send at most one a week. Creating an account on the site
              does not subscribe you to anything.
            </p>
            <p>
              <strong>Confirmation first.</strong> When you enter your address we send one email asking
              you to confirm. Nothing else is sent until you press the confirmation button, and sign-ups
              that are never confirmed are deleted after 30 days. Addresses that signed up before
              23 October 2026, when we introduced confirmation, are kept but not sent anything until
              they confirm.
            </p>
            <p>
              <strong>What we keep as proof of your consent:</strong> your email address, the topics you
              chose, when you asked and when you confirmed, the version of the wording you agreed to, a
              one-way keyed hash of your IP address (not the address itself) and your browser&apos;s
              user-agent string, plus a record of every later change of preference. The legal basis is
              your consent.
            </p>
            <p>
              <strong>Changing your mind.</strong> Every newsletter has a link to change topics or
              unsubscribe in one step, and you can ask for a personal preferences link at{' '}
              <Link href="/newsletter/manage">/newsletter/manage</Link>. When you unsubscribe we stop
              sending straight away and tell our email provider. We keep a record that you withdrew
              consent and a one-way hash of your address on a suppression list, so the address cannot be
              added again unless you subscribe and confirm afresh.
            </p>
            <p>
              <strong>Delivery information.</strong> Our email provider tells us when a newsletter is
              delivered, bounces or is reported as spam. Addresses that permanently bounce or report us
              as spam are not mailed again. We do not track whether you open newsletters or which links
              you click.
            </p>

            <h3>Reader accounts</h3>
            <p>
              If you create an account, we store your name, email address, and a securely hashed
              version of your password (we never store passwords in plain text). We use this to let
              you log in, save articles, and track your reading progress across devices. The legal
              basis is your consent at the point of sign-up. You can request deletion of your
              account and all associated data at any time.
            </p>

            <h3>Reading progress and bookmarks</h3>
            <p>
              If you have an account, we store which articles you have read, how far through each
              article you are, and which articles you have bookmarked. This lets you continue
              reading where you left off. This data is linked to your account and is deleted when
              your account is deleted.
            </p>

            <h3>Contact form submissions</h3>
            <p>
              When you use our contact form, we store your name, email address, subject, and message
              so that we can respond to you. We retain contact messages for up to two years. The
              legal basis is our legitimate interest in responding to enquiries.
            </p>

            <h3>Cookies and visit tracking</h3>
            <p>
              We use a small number of cookies. A visit counter cookie helps us decide when to show
              you our account sign-up prompt. A session cookie is used to keep you logged in if you
              have an account. No advertising or tracking cookies are used.
            </p>
            <p>
              When you first visit the site, you will be asked to accept or decline non-essential
              cookies. If you decline, only the essential session cookie will be used. You can
              change your preference at any time by clearing your browser cookies.
            </p>

            <h3>Reader analytics</h3>
            <p>
              We count article visits, views of other public pages (such as the homepage), and
              approximate active reading time while an article is visible, focused and used within
              the previous minute. We pause active-reading measurement when the article is hidden
              or inactive. Page views are not counts of distinct people. Without consent, analytics
              uses a temporary identifier held only in page memory; it does not recognise you
              across visits.
            </p>
            <p>
              If you accept non-essential storage, a random reader identifier is stored in your
              browser for up to 90 days. A keyed hash lets us estimate returning readership on
              earlier days. It is not linked to your account, email or IP address. Declining removes
              this browser identifier. Active-reading records are retained for approximately 90 days
              with daily cleanup. Referrers contain only website origins, without paths or query
              strings. We do not fingerprint readers.
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
              <li>
                <strong>Newsletter subscriptions:</strong> until you unsubscribe; the record of an
                unsubscribed address is deleted two years after you unsubscribe
              </li>
              <li>
                <strong>Unconfirmed newsletter sign-ups:</strong> 30 days
              </li>
              <li>
                <strong>Newsletter consent records</strong> (when and how you agreed, preference
                changes, hashed IP address, user agent): while your subscription record exists and for
                up to two years after it is deleted, so that we can show you consented
              </li>
              <li>
                <strong>Newsletter suppression list:</strong> a one-way hash of the address only, kept
                for as long as we send newsletters, so that we keep honouring your opt-out
              </li>
              <li>
                <strong>Email delivery notifications</strong> (delivered, bounced, complained): 30 days
              </li>
              <li>
                <strong>Sent newsletter editions:</strong> the content, send time and recipient totals
                are kept as part of the publication&apos;s record; they contain no list of recipients
              </li>
              <li>
                <strong>Account data, reading progress, and bookmarks:</strong> until you delete
                your account
              </li>
              <li>
                <strong>Contact form messages:</strong> up to two years
              </li>
              <li>
                <strong>Login records:</strong> up to one year for security auditing
              </li>
            </ul>
          </section>

          <section>
            <h2>Where your data is stored</h2>
            <p>
              We use third-party hosting and data storage services to operate The Consilium and
              process personal information. Our primary database is hosted in the European Union,
              but other service providers may process some information in other locations.
            </p>
            <p>
              We take appropriate technical and organisational measures to protect personal
              information against unauthorised access, loss, and misuse.
            </p>
          </section>

          <section>
            <h2>Who we share your data with</h2>
            <p>
              We do not sell your personal information. We share it with third-party service
              providers where necessary to operate and maintain The Consilium, including:
            </p>
            <ul>
              <li>
                <strong>Website hosting and delivery services:</strong> process technical request
                information, including IP addresses, to serve pages to your browser.
              </li>
              <li>
                <strong>Database and storage services:</strong> store account information, newsletter
                subscriptions, and other data needed to run the website.
              </li>
              <li>
                <strong>Email delivery services:</strong> process email addresses and relevant message
                information to deliver account notifications and other communications. For the
                newsletter, our email provider also holds the address and topic choices of confirmed
                subscribers, sends each edition, handles one-click unsubscribes and tells us about
                bounces and spam complaints. It may process this information outside the UK under
                appropriate safeguards.
              </li>
            </ul>
            <p>
              We use these providers to deliver and maintain the website and require them to handle
              personal information in accordance with applicable data protection requirements.
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
                <strong>The right to correct:</strong> if any information we hold is inaccurate, you
                can ask us to correct it.
              </li>
              <li>
                <strong>The right to erasure:</strong> you can ask us to delete all personal data we
                hold about you. For account holders, you can do this instantly by contacting us or
                using the deletion option in your account.
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
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond within 30
              days.
            </p>
            <p>
              If you are unhappy with how we handle your data, you have the right to lodge a
              complaint with the{' '}
              <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">
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
            <span className="transition-transform duration-200 group-hover:-translate-x-1">
              &larr;
            </span>
            Back to Homepage
          </Link>
        </div>
      </div>
    </div>
  )
}
