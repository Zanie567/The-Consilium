import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PUBLIC_ARTICLE_SELECT, toPublicArticle } from '@/lib/publicArticle'

const INTERNAL_COLUMNS = [
  'editorNote', 'editorialCommendation', 'engagementScore', 'scheduledAt', 'deletedAt', 'hiddenByDebateAt', 'isDebate',
]

/** Columns the database grants the Data API's anon role on articles. */
function anonArticleGrant(): string[] {
  const sql = readFileSync('supabase/migrations/20260408000100_restrict_column_grants.sql', 'utf8')
  const match = sql.match(/GRANT SELECT \(([^)]*)\)\s*ON articles TO anon;/)
  if (!match) throw new Error('anon article grant not found')
  return match[1].split(',').map((c) => c.trim().replaceAll('"', '')).filter(Boolean).sort()
}

describe('public article projection', () => {
  it('is exactly the column allowlist the database grants anonymous visitors', () => {
    expect(Object.keys(PUBLIC_ARTICLE_SELECT).sort()).toEqual(anonArticleGrant())
  })

  it('never includes editorial, scheduling, scoring or visibility-marker columns', () => {
    for (const column of INTERNAL_COLUMNS) expect(PUBLIC_ARTICLE_SELECT).not.toHaveProperty(column)
  })

  it('copies public columns and named relations only, including from a model that has grown', () => {
    const row = {
      ...Object.fromEntries(Object.keys(PUBLIC_ARTICLE_SELECT).map((k) => [k, `v-${k}`])),
      ...Object.fromEntries(INTERNAL_COLUMNS.map((k) => [k, 'secret'])),
      futureInternalColumn: 'secret',
      author: { id: 'u1', name: 'Writer' },
      notes: [{ body: 'secret' }],
    } as unknown as Record<string, unknown> & Record<keyof typeof PUBLIC_ARTICLE_SELECT, unknown>
    const out = toPublicArticle(row, ['author'])
    expect(Object.keys(out).sort()).toEqual([...Object.keys(PUBLIC_ARTICLE_SELECT), 'author'].sort())
    expect(JSON.stringify(out)).not.toContain('secret')
  })
})
