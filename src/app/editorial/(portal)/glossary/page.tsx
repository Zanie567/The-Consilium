import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getVerifiedSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GLOSSARY_MANAGE_ROLES } from '@/lib/rbac'
import { GLOSSARY_ENABLED_KEY } from '@/lib/constants'
import { GlossaryManager } from '@/components/editorial/GlossaryManager'

export const metadata: Metadata = {
  title: 'Glossary | Editorial',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function GlossaryAdminPage() {
  // Role gate: re-verified against the database, never trusted from the JWT.
  // The allowed roles live in GLOSSARY_MANAGE_ROLES in src/lib/rbac.ts.
  const user = await getVerifiedSessionUser(GLOSSARY_MANAGE_ROLES)
  if (!user) notFound()

  // Both reads are wrapped so the page still renders before the
  // glossary_terms table has been created in Supabase.
  const [terms, setting] = await Promise.all([
    prisma.glossaryTerm
      .findMany({
        orderBy: { term: 'asc' },
        select: {
          id: true,
          term: true,
          aliases: true,
          definition: true,
          learnMoreUrl: true,
          isActive: true,
          updatedAt: true,
        },
      })
      .catch(() => null),
    prisma.siteSetting
      .findUnique({ where: { key: GLOSSARY_ENABLED_KEY }, select: { value: true } })
      .catch(() => null),
  ])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
      <div className="mb-6 sm:mb-8 pl-10 md:pl-0">
        <h1
          className="text-2xl font-bold text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Glossary
        </h1>
        <p className="text-[var(--fg-faint)] text-sm mt-1">
          Definitions that appear as hover tooltips on glossary terms in published articles.
        </p>
      </div>

      {terms === null ? (
        <p className="text-sm text-[var(--fg-faint)] border border-dashed border-[var(--border)] rounded-lg p-8 text-center">
          The glossary table does not exist yet. Run the SQL in
          supabase/manual/20260610_glossary_terms.sql in the Supabase SQL editor, then reload
          this page.
        </p>
      ) : (
        <GlossaryManager
          initialTerms={terms.map((t) => ({
            id: t.id,
            term: t.term,
            aliases: t.aliases,
            definition: t.definition,
            learnMoreUrl: t.learnMoreUrl,
            isActive: t.isActive,
            updatedAt: t.updatedAt.toISOString(),
          }))}
          initialEnabled={setting?.value === 'true'}
        />
      )}
    </div>
  )
}
