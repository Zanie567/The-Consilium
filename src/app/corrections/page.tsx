import Link from 'next/link'
import type { Metadata } from 'next'
import { canonicalAlternates } from '@/lib/seo'
import { CONTACT_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: 'Corrections Policy',
  description:
    'How The Consilium handles corrections, and how to report an error.',
  alternates: canonicalAlternates('/corrections'),
}

export default function CorrectionsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Header */}
        <div className="mb-12 pb-8 border-b border-[var(--border)]">
          <p className="text-gold text-[0.65rem] font-bold uppercase tracking-[0.3em] mb-4">
            Editorial Standards
          </p>
          <h1
            className="text-4xl sm:text-5xl font-bold text-[var(--fg)] leading-tight mb-5"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Corrections Policy
          </h1>
          <p className="text-[var(--fg-muted)] text-lg leading-relaxed">
            The Consilium holds itself to the same standards of accuracy that we demand of the ideas
            we scrutinise. When we get something wrong, we correct it promptly and say what changed.
          </p>
        </div>

        <div className="prose-consilium space-y-10">

          <section>
            <h2>Accuracy</h2>
            <p>
              Every article published in The Consilium is reviewed by an editor before publication.
              We check facts, verify figures, and confirm the integrity of arguments. Despite these
              efforts, errors occasionally occur: in statistics, in the spelling of names, in the
              attribution of quotes, or in matters of interpretation. When they do, we correct them.
            </p>
            <p>
              We do so openly: we do not quietly revise copy or leave a known error to stand.
            </p>
          </section>

          <section>
            <h2>What we correct</h2>
            <p>
              We will issue a correction for any factual error, including but not limited to:
            </p>
            <ul>
              <li>Incorrect statistics, data, or figures</li>
              <li>Misattributed or inaccurately quoted statements</li>
              <li>Errors in names, titles, or organisational affiliations</li>
              <li>Factual claims that are demonstrably false</li>
              <li>Significant misrepresentations of an individual{"'"}s published views</li>
            </ul>
            <p>
              We distinguish corrections from updates. A <strong>correction</strong> acknowledges
              that something we published was wrong at the time of publication. An{' '}
              <strong>update</strong> reflects information that has changed since publication: for
              example, a policy that has since been amended, or a situation that has developed
              further. Both are labelled clearly on the article.
            </p>
          </section>

          <section>
            <h2>How to submit a correction request</h2>
            <p>
              If you believe we have published an error, please contact us using one of the
              following methods:
            </p>

            <div className="not-prose my-6 space-y-4">
              <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
                <p className="text-[var(--fg)] font-semibold text-sm mb-1">By email</p>
                <p className="text-[var(--fg-muted)] text-sm mb-2">
                  Send a detailed message to our editorial team:
                </p>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Correction%20Request`}
                  className="text-gold font-semibold text-sm hover:underline"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>

              <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
                <p className="text-[var(--fg)] font-semibold text-sm mb-1">Via the contact form</p>
                <p className="text-[var(--fg-muted)] text-sm mb-2">
                  Use the subject line &ldquo;Correction Request&rdquo; and include the article
                  title.
                </p>
                <Link href="/contact" className="text-gold font-semibold text-sm hover:underline">
                  Go to the contact form
                </Link>
              </div>
            </div>

            <p>When contacting us, please include:</p>
            <ul>
              <li>The title and URL of the article in question</li>
              <li>The specific claim or passage you believe to be incorrect</li>
              <li>The evidence you are relying on for your correction</li>
              <li>Your name and contact details (we may follow up with questions)</li>
            </ul>
          </section>

          <section>
            <h2>Our process</h2>
            <p>
              We aim to acknowledge all correction requests within <strong>48 hours</strong> of
              receipt and to resolve them within <strong>five working days</strong>. Where a claim
              requires additional research or verification, we will advise you of the expected
              timeline.
            </p>
            <p>
              Once a correction has been verified and approved by a senior editor:
            </p>
            <ul>
              <li>
                A correction notice is added to the top of the article, alerting readers that the
                piece has been updated
              </li>
              <li>
                A correction note at the end of the article states exactly what was changed, and
                when
              </li>
              <li>The original error is not silently deleted; the nature of the correction is explained</li>
              <li>The article{"'"}s timestamp is updated to reflect the correction</li>
            </ul>
            <p>
              We do not remove articles from the record except in exceptional circumstances, for
              example where continued publication would cause harm or where an article has been
              found to be substantially fabricated. In such cases, we publish a note explaining
              why the article has been removed.
            </p>
          </section>

          <section>
            <h2>Responding to readers</h2>
            <p>
              We appreciate all correction requests, even those that turn out not to require a
              change. We will always explain our reasoning if we decide that a correction is not
              warranted. Factual disputes are different from differences of interpretation or
              opinion: we will not issue a correction because a reader disagrees with an
              author{"'"}s analysis or conclusions.
            </p>
          </section>

          <section>
            <h2>Contact the editorial team</h2>
            <p>
              For all editorial enquiries, including corrections, complaints, and feedback, please
              contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              . We read and respond to every message.
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
