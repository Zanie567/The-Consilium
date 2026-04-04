import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { Mail } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Our Team',
  description: 'Meet the team behind The Consilium, the publication of the University of Edinburgh Economics Society.',
}

async function getTeamMembers() {
  try {
    return await prisma.teamMember.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    })
  } catch {
    return []
  }
}

export default async function TeamPage() {
  const members = await getTeamMembers()

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <section className="bg-navy py-14 px-4 border-b-2 border-gold text-center">
        <p className="text-gold/60 text-xs tracking-[0.3em] uppercase mb-3">The Consilium</p>
        <h1
          className="text-4xl sm:text-5xl font-bold text-gold mb-4"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Our Team
        </h1>
        <p className="text-cream/60 text-sm max-w-xl mx-auto">
          The students and society members who produce The Consilium
        </p>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {members.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {members.map((member) => (
              <div
                key={member.id}
                className="bg-white border border-gold/15 p-6 flex flex-col items-center text-center"
              >
                {/* Avatar */}
                <div className="relative w-24 h-24 mb-4 overflow-hidden rounded-full bg-navy">
                  {member.image ? (
                    <Image
                      src={member.image}
                      alt={member.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span
                        className="text-gold text-2xl font-bold"
                        style={{ fontFamily: 'var(--font-serif)' }}
                      >
                        {member.name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>

                <h3
                  className="text-navy font-bold text-lg mb-1"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  {member.name}
                </h3>
                <p className="text-gold text-xs font-bold uppercase tracking-widest mb-3">
                  {member.role}
                </p>

                {member.bio && (
                  <p className="text-navy/60 text-sm leading-relaxed mb-4">
                    {member.bio}
                  </p>
                )}

                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="inline-flex items-center gap-2 text-navy/50 hover:text-gold transition-colors text-xs"
                  >
                    <Mail size={14} />
                    {member.email}
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <p
              className="text-4xl font-bold text-navy/20 mb-3"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Team information coming soon
            </p>
            <p className="text-navy/40 text-sm">
              Our team profiles will be published shortly.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
