'use client'

import { useEffect } from 'react'

/**
 * Last-resort error boundary. Next.js renders this ONLY when the root layout
 * itself (or one of its providers) throws — at which point the normal
 * `app/error.tsx` cannot help because the layout that hosts it never mounted.
 * global-error therefore REPLACES the root layout and must render its own
 * <html>/<body>.
 *
 * Because the thing that failed might be the CSS pipeline, the theme provider, or
 * the web fonts, this component deliberately depends on NONE of them: every style
 * is inline with hard-coded brand colours and a system-serif fallback, so it
 * always renders on-brand even when everything else is broken. Without this file
 * Next.js shows its plain default "a server error occurred" page (the black screen
 * users were seeing).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface for an error-reporting service. digest is the only safe id to show.
    console.error('[GlobalError]', error.digest ?? '(no digest)', error.message)
  }, [error])

  const NAVY = '#1a2744'
  const NAVY_DARK = '#111b33'
  const GOLD = '#c9a227'
  const CREAM = '#faf8f3'
  const serif = "'Playfair Display', Georgia, 'Times New Roman', serif"

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          background: `radial-gradient(circle at 50% 30%, ${NAVY} 0%, ${NAVY_DARK} 70%)`,
          color: CREAM,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {/* Warning emblem */}
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke={GOLD}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ marginBottom: '28px' }}
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>

        <p
          style={{
            color: GOLD,
            fontSize: '0.7rem',
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            fontWeight: 600,
            margin: '0 0 16px',
          }}
        >
          Something went wrong
        </p>

        <h1
          style={{
            fontFamily: serif,
            fontWeight: 800,
            fontSize: 'clamp(2rem, 5vw, 3.25rem)',
            lineHeight: 1.1,
            margin: '0 0 20px',
            color: CREAM,
          }}
        >
          The Consilium is temporarily unavailable
        </h1>

        <div
          style={{
            width: '48px',
            height: '2px',
            background: 'rgba(201,162,39,0.5)',
            margin: '0 0 24px',
          }}
        />

        <p
          style={{
            maxWidth: '34rem',
            fontSize: '1rem',
            lineHeight: 1.65,
            color: 'rgba(250,248,243,0.75)',
            margin: '0 0 40px',
          }}
        >
          A server error stopped this page from loading. Please try again — if the
          problem continues, head back to the homepage.
          {error.digest && (
            <span
              style={{
                display: 'block',
                marginTop: '12px',
                fontSize: '0.72rem',
                fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
                color: 'rgba(250,248,243,0.4)',
              }}
            >
              Reference: {error.digest}
            </span>
          )}
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={() => reset()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: NAVY,
              color: GOLD,
              border: `1px solid rgba(201,162,39,0.4)`,
              padding: '13px 32px',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {/* Plain anchor (not next/link): forces a full reload to a clean app
              shell, which is what we want when the root layout has failed. The
              lint rule is suppressed because that hard navigation is intentional. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              color: GOLD,
              textDecoration: 'none',
              padding: '13px 8px',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
            }}
          >
            ← Back to Homepage
          </a>
        </div>
      </body>
    </html>
  )
}
