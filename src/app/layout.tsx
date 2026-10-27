import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Playfair_Display, Inter } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { ScrollIndicator } from '@/components/ui/ScrollIndicator'
import { SitePageViewCounter } from '@/components/ui/SitePageViewCounter'
import { SiteChrome } from '@/components/layout/SiteChrome'
import { SignupPrompt } from '@/components/ui/SignupPrompt'
import { CookieConsentBanner } from '@/components/ui/CookieConsent'
import { InstallBanner } from '@/components/ui/InstallBanner'
import { RevealOnScroll } from '@/components/ui/RevealOnScroll'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants'
import { DEFAULT_SHARE_IMAGE, pageTwitter } from '@/lib/seo'
import { BRAND_NAVY } from '@/lib/brand'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800', '900'],
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// EB Garamond (the editor's document face) is loaded by src/lib/editorFont.ts,
// only where the editor renders.

export const viewport: Viewport = {
  themeColor: BRAND_NAVY,
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'The Consilium | University of Edinburgh Economics Society',
    template: '%s | The Consilium',
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'economics',
    'University of Edinburgh',
    'student publication',
    'economic analysis',
    'opinion',
  ],
  robots: { index: process.env.TESTING_MODE_ENABLED !== '1', follow: process.env.TESTING_MODE_ENABLED !== '1' },
  openGraph: {
    title: 'The Consilium',
    description: SITE_DESCRIPTION,
    type: 'website',
    locale: 'en_GB',
    // Deliberately no `url` here. Metadata merges shallowly, so a fixed URL is
    // inherited verbatim by every page that does not set its own `openGraph` —
    // which had every article and category page reporting og:url as the
    // homepage. Pages set their own via `pageOpenGraph()` in src/lib/seo.ts.
    siteName: SITE_NAME,
    images: [DEFAULT_SHARE_IMAGE],
  },
  twitter: pageTwitter({ title: 'The Consilium' }),
  // Icons come from the file conventions in src/app — favicon.ico, icon1.png, icon2.png,
  // apple-icon.png — which Next links with a content hash, so a new design reaches browsers
  // without a cache purge. All are opaque navy squares (scripts/brand/generate-app-icons.mjs).

  // Home-screen label. `capable: false` is explicit because Next defaults it to true, which would
  // make iOS launch the site as a full-screen app with no browser controls.
  appleWebApp: { title: SITE_NAME, capable: false },
  alternates: {
    // Deliberately no `canonical` here. Metadata merges shallowly, so a
    // canonical set at the root is inherited by every page that does not
    // override it — which had the whole site declaring itself a duplicate of
    // the homepage. A page with no canonical is self-canonical by default,
    // which is the correct fallback; indexable pages opt in explicitly via
    // `canonicalAlternates()` in src/lib/seo.ts.
    types: {
      'application/rss+xml': `${SITE_URL}/feed.xml`,
    },
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const testWorkspace = process.env.TESTING_MODE_ENABLED === '1'
  const session = testWorkspace ? await getServerSession(authOptions) : undefined
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)]" style={testWorkspace ? { paddingTop: 'var(--testing-banner-height, 40px)' } : undefined}>
        {/* Development can restore an unfinished streamed HTML response from its
            history cache. Fetch a complete current identity before hydrating it.
            Production history uses the hydrated identity checks in AuthProvider. */}
        {testWorkspace && process.env.NODE_ENV === 'development' && <Script id="testing-history-identity" strategy="beforeInteractive">{`
          if (performance.getEntriesByType('navigation')[0]?.type === 'back_forward') location.reload();
          else addEventListener('pageshow', function(event) { if (event.persisted) location.reload(); });
        `}</Script>}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-navy focus:text-gold focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:uppercase focus:tracking-widest focus:border focus:border-gold/60"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <AuthProvider session={session} testWorkspace={testWorkspace}>
            <SiteChrome>
              <ScrollIndicator />
            </SiteChrome>
            <SitePageViewCounter />
            <Navbar />
            <main id="main-content" className="flex-1">{children}</main>
            <SiteChrome>
              <Footer />
            </SiteChrome>
            <SignupPrompt />
            <CookieConsentBanner />
            <InstallBanner />
            <RevealOnScroll />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
