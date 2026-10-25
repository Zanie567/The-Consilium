import { describe, expect, it } from 'vitest'
import { classify } from '../../scripts/ops/vercel-deployment-inventory.mjs'

let t = 1_000_000
const dep = (uid: string, target: 'production' | null, state: string, branch: string) =>
  ({ uid, url: `${uid}.vercel.app`, created: (t += 1000), target, state, meta: { githubCommitRef: branch, githubCommitSha: 'abcdef1234' } })

describe('deployment inventory classification', () => {
  // Oldest first; classify sorts newest first itself.
  const deployments = [
    ...Array.from({ length: 8 }, (_, i) => dep(`prod${i}`, 'production', 'READY', 'main')),
    dep('merged-preview', null, 'READY', 'feat/merged'),
    dep('open-old', null, 'READY', 'feat/open'),
    dep('open-new', null, 'READY', 'feat/open'),
    dep('failed', null, 'ERROR', 'feat/merged'),
    dep('failed-open', null, 'ERROR', 'feat/open'),
    dep('cancelled', null, 'CANCELED', 'feat/merged'),
    dep('building', null, 'BUILDING', 'feat/other'),
    dep('newest1', null, 'READY', 'feat/merged'),
    dep('newest2', null, 'READY', 'feat/merged'),
  ]
  const rows = Object.fromEntries(classify(deployments, { openPrBranches: new Set(['feat/open']) }).map((r) => [r.uid, r]))

  it('protects current production and the newest production rollback history', () => {
    expect(rows.prod7).toMatchObject({ class: 'PROTECTED', reason: expect.stringContaining('current production') })
    for (const uid of ['prod6', 'prod5', 'prod4', 'prod3']) expect(rows[uid].class).toBe('PROTECTED')
    for (const uid of ['prod2', 'prod1', 'prod0']) expect(rows[uid]).toMatchObject({ class: 'SAFE', reason: 'superseded production deployment' })
  })

  it('protects the newest preview of an open PR and flags its older previews for review', () => {
    expect(rows['open-new'].class).toBe('PROTECTED')
    expect(rows['open-old'].class).toBe('REVIEW')
    // Its build log may still matter to the author.
    expect(rows['failed-open'].class).toBe('REVIEW')
  })

  it('protects anything still building and the 3 newest deployments', () => {
    expect(rows.building.class).toBe('PROTECTED')
    expect(rows.newest1.class).toBe('PROTECTED')
    expect(rows.newest2.class).toBe('PROTECTED')
  })

  it('offers merged-branch previews and failed or cancelled builds as safe candidates', () => {
    expect(rows['merged-preview'].class).toBe('SAFE')
    expect(rows.failed).toMatchObject({ class: 'SAFE', reason: expect.stringContaining('no functions stored') })
    expect(rows.cancelled.class).toBe('SAFE')
  })
})
