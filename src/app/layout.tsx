import type { Metadata } from 'next'
import { Playfair_Display, Inter, EB_Garamond } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { ScrollIndicator } from '@/components/ui/ScrollIndicator'
import { SignupPrompt } from '@/components/ui/SignupPrompt'
import { CookieConsentBanner } from '@/components/ui/CookieConsent'
import { InstallBanner } from '@/components/ui/InstallBanner'
import { FaviconSwitcher } from '@/components/ui/FaviconSwitcher'
import { SITE_URL } from '@/lib/constants'

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

const ebGaramond = EB_Garamond({
  subsets: ['latin'],
  variable: '--font-eb-garamond',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'The Consilium | University of Edinburgh Economics Society',
    template: '%s | The Consilium',
  },
  description:
    'The Consilium is the official publication of the University of Edinburgh Economics Society, bringing you rigorous economic analysis, opinion, and commentary.',
  keywords: [
    'economics',
    'University of Edinburgh',
    'student publication',
    'economic analysis',
    'opinion',
  ],
  openGraph: {
    title: 'The Consilium',
    description: 'Ratione et Consilio',
    type: 'website',
    locale: 'en_GB',
    images: [{ url: '/logo.png', width: 512, height: 512 }],
  },
  icons: {
    icon: [
      // Light browser theme → dark navy emblem (high contrast on light tab bar)
      { url: '/favicon-navy-32.png', sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/favicon-navy-16.png', sizes: '16x16', type: 'image/png', media: '(prefers-color-scheme: light)' },
      // Dark browser theme → cream emblem (high contrast on dark tab bar)
      { url: '/favicon-cream-32.png', sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: dark)' },
      { url: '/favicon-cream-16.png', sizes: '16x16', type: 'image/png', media: '(prefers-color-scheme: dark)' },
      // Universal fallback for browsers that ignore media on <link rel="icon">
      { url: '/favicon.ico', sizes: 'any' },
    ],
    // src/app/icon.png (512px navy) also generates an unconditional fallback link automatically
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  alternates: {
    types: {
      'application/rss+xml': `${SITE_URL}/feed.xml`,
    },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable} ${ebGaramond.variable} h-full`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-navy focus:text-gold focus:px-4 focus:py-2 focus:text-xs focus:font-bold focus:uppercase focus:tracking-widest focus:border focus:border-gold/60"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <AuthProvider>
            <ScrollIndicator />
            <Navbar />
            <main id="main-content" className="flex-1">{children}</main>
            <Footer />
            <SignupPrompt />
            <CookieConsentBanner />
            <InstallBanner />
            <FaviconSwitcher />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
