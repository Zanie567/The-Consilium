import { it, expect, vi } from 'vitest'
import { deploymentReadiness } from '../../src/lib/deploymentReadiness'
it('fails visibly for a missing ownership/placement schema, uniqueness, RLS and storage', async () => {
  const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('storage absent'))
  const result = await deploymentReadiness({ $queryRaw: query })
  expect(result.healthy).toBe(false)
  expect(result.gaps).toContain('Missing schema: team_members.userId')
  expect(result.gaps).toContain('Missing schema: team_members.publicTier')
  // The admin overhaul's additive migrations are reported by name, not as a runtime crash.
  for (const gap of ['team_members.updatedAt', 'debates.unpublishedAt', 'debates.deletedAt', 'debates.deletedById', 'articles.hiddenByDebateAt']) {
    expect(result.gaps).toContain(`Missing schema: ${gap}`)
  }
  expect(result.gaps).toContain('Missing one-card-per-account unique index')
  expect(result.gaps).toContain('Testing session row-level security is missing')
  expect(result.gaps).toContain('Storage bucket configuration cannot be read')
  expect(result.gaps).toContain('Missing database guard: articles_hidden_debate_guard (migration 20261011)')
  expect(result.gaps).toContain('Missing database trigger: articles_clear_hidden_by_debate (migration 20261012100000)')
})
it('fails for missing avatar bucket even when schema checks succeed', async () => {
  const fields = ['userId','publicTier','updatedAt'].map(column_name => ({ table_name: 'team_members', column_name }))
  fields.push(...['unpublishedAt','deletedAt','deletedById'].map(column_name => ({ table_name: 'debates', column_name })))
  fields.push({ table_name: 'articles', column_name: 'hiddenByDebateAt' })
  fields.push(...['testPersonaKey','testingRevision'].map(column_name => ({ table_name: 'users', column_name })))
  fields.push(...['id','tokenHash','administratorId','personaId','revision','createdAt','expiresAt','stoppedAt','stopReason'].map(column_name => ({ table_name: 'testing_sessions', column_name })))
  const query = vi.fn().mockResolvedValueOnce(fields).mockResolvedValueOnce([{ indexdef: 'CREATE UNIQUE INDEX ON public.team_members USING btree ("userId")' }]).mockResolvedValueOnce([{ relrowsecurity: true }]).mockResolvedValueOnce([{ tgname: 'articles_hidden_debate_guard' }, { tgname: 'articles_clear_hidden_by_debate' }]).mockResolvedValueOnce([{ id: 'article-images', public: true }])
  expect(await deploymentReadiness({ $queryRaw: query }, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55423', SUPABASE_SERVICE_ROLE_KEY: 'local-service-key' })).toEqual({ healthy: false, gaps: ['Missing public storage bucket: avatars'] })
})
