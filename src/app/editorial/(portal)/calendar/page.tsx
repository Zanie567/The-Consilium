import Link from 'next/link'
import { CalendarDays, Clock, PenLine } from 'lucide-react'
import { PortalPage, PortalSection } from '@/components/editorial/PortalAnimated'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Calendar | Editorial',
  robots: { index: false, follow: false },
}

const calendarItems = [
  {
    label: 'Editorial meeting',
    detail: 'Weekly planning slot',
    time: 'Monday',
  },
  {
    label: 'Publishing review',
    detail: 'Check scheduled pieces and homepage priorities',
    time: 'Wednesday',
  },
  {
    label: 'Events planning',
    detail: 'Coordinate upcoming Economics Society activity',
    time: 'Friday',
  },
]

export default function EditorialCalendarPage() {
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
          Calendar
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--fg-muted)]">
          A compact planning view for editorial deadlines, event dates, and society activity.
        </p>
      </PortalSection>

      <PortalSection className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--border)] px-6 py-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--fg)]">
              This Week
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {calendarItems.map((item) => (
              <div key={item.label} className="flex gap-4 px-6 py-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-gold/25 bg-gold/8 text-gold">
                  <CalendarDays size={17} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-semibold text-[var(--fg)]">{item.label}</h3>
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-gold">
                      {item.time}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--fg-muted)]">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
            <Clock className="mb-4 text-gold" size={20} aria-hidden="true" />
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--fg)]">
              Planning note
            </p>
            <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
              Keep this calendar focused on deadlines and activity that affect The Consilium publishing schedule.
            </p>
          </div>
          <Link
            href="/editorial/events"
            className="flex min-h-12 items-center justify-center gap-2 bg-navy px-5 py-3 text-xs font-bold uppercase tracking-widest text-gold hover:bg-navy-dark"
          >
            <PenLine size={15} aria-hidden="true" />
            View Events
          </Link>
        </aside>
      </PortalSection>
    </PortalPage>
  )
}
