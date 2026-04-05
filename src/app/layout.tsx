import type { Metadata } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { AuthProvider } from '@/components/layout/AuthProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { ScrollIndicator } from '@/components/ui/ScrollIndicator'

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

export const metadata: Metadata = {
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
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'The Consilium',
    description: 'The voice of the University of Edinburgh Economics Society',
    type: 'website',
    locale: 'en_GB',
    images: [{ url: '/logo.png', width: 512, height: 512 }],
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
      className={`${playfair.variable} ${inter.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--bg)] text-[var(--fg)]">
        <ThemeProvider>
          <AuthProvider>
            <ScrollIndicator />
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
