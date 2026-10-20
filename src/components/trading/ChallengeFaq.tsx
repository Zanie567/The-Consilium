import { Plus } from 'lucide-react'
import { TRADING_CHALLENGE as TC, formatChallengeDate } from '@/lib/tradingChallenge'

/**
 * Frequently asked questions as native <details> disclosures: keyboard and
 * screen-reader accessible, and they work without JavaScript.
 */

const link = 'font-semibold text-[var(--fg)] underline decoration-gold/60 underline-offset-4 hover:decoration-gold'

export function ChallengeFaq() {
  const email = (
    <a href={`mailto:${TC.supportEmail}`} className={link}>
      {TC.supportEmail}
    </a>
  )
  const groups: { heading: string; items: { q: string; a: React.ReactNode }[] }[] = [
    {
      heading: 'Taking part',
      items: [
        {
          q: 'Do I need investment experience to take part?',
          a: 'No. Everyone starts with the same virtual $100,000, and the Challenge is a low-stakes way to learn how markets behave by trying it yourself.',
        },
        {
          q: 'Do I need to invest real money?',
          a: 'No. All trading is simulated with virtual money on MarketWatch, so you cannot lose real money. The only real money involved is the prizes, paid by EconSoc.',
        },
        {
          q: 'Why do I need a MarketWatch account?',
          a: 'The Challenge runs on MarketWatch’s free Virtual Stock Exchange. Your trades, portfolio and the rankings all live there, so you need an account to join the private game.',
        },
        {
          q: 'Where do I find my MarketWatch username?',
          a: 'It is the name MarketWatch shows for your account when you are signed in, and the name other players see in the game’s rankings. Enter it exactly in the registration form, not your email address.',
        },
        {
          q: 'Can I change my MarketWatch username after registering?',
          a: (
            <>
              Please keep it the same: entries are matched to registrations by that name. If you have to change it, email{' '}
              {email} with your old and new names so the committee can update your registration.
            </>
          ),
        },
        {
          q: 'Can I join after the competition starts?',
          a: `Yes. Late entry is open while the game runs, until ${formatChallengeDate(TC.endDate)}. You start with the same $100,000 as everyone else; you just have less time to trade.`,
        },
      ],
    },
    {
      heading: 'Membership and your login',
      items: [
        {
          q: 'Do I need an EconSoc membership?',
          a: (
            <>
              Yes, a paid EconSoc membership. You can buy one on{' '}
              <a href={TC.links.membership} target="_blank" rel="noopener noreferrer" className={link}>
                EconSoc’s EUSA page<span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </>
          ),
        },
        {
          q: 'Can non-student members take part?',
          a: (
            <>
              Yes, paid non-student EconSoc members are welcome. To register, email {email} with your full name, your
              MarketWatch display name and the email address you used to buy your membership. The committee checks your
              membership by hand and sends your login details once that check is complete.
            </>
          ),
        },
        {
          q: 'When will I receive the game password?',
          a: 'If you are a student already on EconSoc’s membership list, usually shortly after you register, by email to your university address. Otherwise, including for non-student members, it is sent once your membership has been verified.',
        },
        {
          q: 'I bought my membership recently. What happens?',
          a: 'New purchases are not passed to EconSoc instantly; the membership list is refreshed from EUSA’s records periodically. You will get an email saying your registration is pending. Pending registrations are rechecked every hour, so your login is sent once your purchase appears on the list. You do not need to register again.',
        },
        {
          q: 'My login email hasn’t arrived. What should I do?',
          a: (
            <>
              Check your junk or spam folder first, especially in university mail. If it is not there, email {email} with your
              name and MarketWatch username. Never send a password by email.
            </>
          ),
        },
      ],
    },
    {
      heading: 'Results',
      items: [
        {
          q: 'How are winners selected?',
          a: 'From MarketWatch’s final rankings when the game ends. The three highest-ranked eligible entries win, after the committee has checked them against registrations and membership records. Verified winners are announced on this page.',
        },
        {
          q: 'What happens if someone joins without a valid membership?',
          a: 'The password is only sent to verified members. Anyone in the game without a valid paid membership or matching registration is not eligible for a prize and may be removed from the game.',
        },
        {
          q: 'Who do I contact if I have a problem?',
          a: <>Email EconSoc at {email}.</>,
        },
      ],
    },
  ]

  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <div key={g.heading}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fg-muted)]">{g.heading}</h3>
          <div className="mt-3 border-t border-[var(--border-strong)]">
            {g.items.map((item) => (
              <details key={item.q} className="trading-faq group border-b border-[var(--border-strong)]">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 text-left font-semibold text-[var(--fg)] hover:text-gold-dark dark:hover:text-gold">
                  <span>{item.q}</span>
                  <Plus size={18} aria-hidden className="trading-faq-icon shrink-0 text-gold-dark transition-transform duration-200 group-open:rotate-45 dark:text-gold" />
                </summary>
                <div className="pb-5 pr-10 text-[0.95rem] leading-relaxed text-[var(--fg-muted)]">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
