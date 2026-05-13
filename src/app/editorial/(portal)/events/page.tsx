import Link from 'next/link'
import { CalendarPlus, MapPin, Users } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Events | Editorial',
  robots: { index: false, follow: false },
}

export default function EditorialEventsPage() {
  return (
    <PortalPage className="max-w-6xl p-4 sm:p-6 lg:p-8">
      <PortalSection className="mb-8 pl-10 md:pl-0">
        <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.35em] text-gold/70">
          Dashboard
        </p>
        <h1
          className="mb-2 text-3xl font-bold text-[var(--fg)] sm:text-4xl"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Events
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)]">
          Coordinate Economics Society events, publication coverage, and speaker activity from one place.
        </p>
      </PortalSection>

      <PortalSection className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: 'Upcoming Events', value: '0', icon: CalendarPlus },
          { label: 'Venues', value: '0', icon: MapPin },
          { label: 'Speakers', value: '0', icon: Users },
        ].map((item) => (
          <div
            key={item.label}
            className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center border border-gold/25 bg-gold/8 text-gold">
                <item.icon size={17} aria-hidden="true" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
                Live
              </span>
            </div>
            <p className="text-[0.65rem] font-bold uppercase tracking-widest text-[var(--fg-faint)]">
              {item.label}
            </p>
            <p
              className="mt-2 text-3xl font-bold text-[var(--fg)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {item.value}
            </p>
          </div>
        ))}
      </PortalSection>

      <PortalSection>
        <div className="border border-dashed border-gold/30 bg-[var(--bg-elevated)] px-6 py-16 text-center shadow-[var(--shadow-card)]">
          <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.3em] text-gold/70">
            Events workspace
          </p>
          <h2
            className="mb-3 text-2xl font-bold text-[var(--fg)]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            Event planning is ready for content.
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-sm leading-relaxed text-[var(--fg-muted)]">
            Use this section for event listings, speaker notes, venue details, and related publication plans as the society calendar is built out.
          </p>
          <Link
            href="/editorial/calendar"
            className="inline-flex min-h-11 items-center justify-center bg-navy px-5 py-3 text-xs font-bold uppercase tracking-widest text-gold hover:bg-navy-dark"
          >
            Open Calendar
          </Link>
        </div>
      </PortalSection>
    </PortalPage>
  )
}
