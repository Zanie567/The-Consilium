import Link from 'next/link'
import { Mail } from 'lucide-react'

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/>
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
      <rect x="2" y="9" width="4" height="12"/>
      <circle cx="4" cy="4" r="2"/>
    </svg>
  )
}

const sectionLinks = [
  { href: '/category/news', label: 'News' },
  { href: '/category/opinion', label: 'Opinion' },
  { href: '/category/analysis', label: 'Analysis' },
  { href: '/category/interviews', label: 'Interviews' },
  { href: '/archive', label: 'Archive' },
]

const orgLinks = [
  { href: '/about', label: 'About Us' },
  { href: '/team', label: 'Our Team' },
  { href: '/contact', label: 'Contact' },
  { href: '/corrections', label: 'Corrections Policy' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/search', label: 'Search' },
]

export function Footer() {
  return (
    <footer className="bg-navy text-cream">
      <div className="h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent opacity-60" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Branding */}
          <div className="md:col-span-1">
            <Link
              href="/"
              className="text-gold font-serif text-2xl font-bold tracking-widest uppercase block mb-3 hover:opacity-85 transition-opacity duration-200"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              The Consilium
            </Link>
            <p className="text-cream/60 text-sm leading-relaxed mb-4">
              The official publication of the University of Edinburgh Economics Society.
              Rigorous analysis. Independent voice.
            </p>
            <p className="text-cream/35 text-xs">
              University of Edinburgh Economics Society
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="text-gold text-[0.65rem] font-bold uppercase tracking-widest mb-5">
              Sections
            </h3>
            <ul className="space-y-2.5">
              {sectionLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-cream/60 text-sm hover:text-gold transition-colors duration-200 hover:translate-x-0.5 inline-block"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Organisation */}
          <div>
            <h3 className="text-gold text-[0.65rem] font-bold uppercase tracking-widest mb-5">
              Organisation
            </h3>
            <ul className="space-y-2.5 mb-7">
              {orgLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-cream/60 text-sm hover:text-gold transition-colors duration-200 hover:translate-x-0.5 inline-block"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3">
              <a
                href="https://www.instagram.com/theconsilium.editor/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cream/45 hover:text-gold transition-colors duration-200 hover:scale-110 inline-block"
                aria-label="Instagram"
              >
                <InstagramIcon />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cream/45 hover:text-gold transition-colors duration-200 hover:scale-110 inline-block"
                aria-label="LinkedIn"
              >
                <LinkedInIcon />
              </a>
              <a
                href="mailto:theconsilium.editor@gmail.com"
                className="text-cream/45 hover:text-gold transition-colors duration-200 hover:scale-110 inline-block"
                aria-label="Email"
              >
                <Mail size={17} />
              </a>
            </div>
            <p className="text-cream/35 text-xs mt-3">
              <a
                href="mailto:theconsilium.editor@gmail.com"
                className="hover:text-gold transition-colors duration-200"
              >
                theconsilium.editor@gmail.com
              </a>
            </p>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-navy-light">
          <div className="text-center mb-8">
            <p className="text-cream/45 text-xs mb-2">
              Have feedback or a suggestion? Fill out this form to let us know.
            </p>
            <a
              href="https://forms.gle/ufUnT7sDoKagnLqGA"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-gold text-xs font-bold uppercase tracking-widest border border-gold/40 px-5 py-2 hover:bg-gold hover:text-navy transition-all duration-200"
            >
              Share Your Feedback
            </a>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-center sm:text-left">
            <p className="text-cream/30 text-xs">
              &copy; {new Date().getFullYear()} The Consilium, University of Edinburgh
              Economics Society. All rights reserved.
            </p>
            <p className="text-cream/20 text-[10px] mt-1">
              Founded by Alex Escala, Lucas Dwyer and Satvik Singla
            </p>
          </div>
          <p className="text-cream/20 text-xs">Edinburgh, Scotland</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
