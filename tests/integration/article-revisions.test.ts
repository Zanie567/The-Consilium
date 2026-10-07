import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { Session } from './helpers/http'
import { randomUUID } from 'node:crypto'
import type { ArticleStatus } from '@prisma/client'

const base = process.env.BASE_URL!
const session = new Session(base)
const ids: string[] = []
let authorId: string
let seriesId: string
beforeAll(async () => {
  expect(await session.login('admin@theconsilium.com', 'consilium2024')).toBe(true)
  authorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@theconsilium.com' } })).id
  seriesId = (await prisma.series.create({ data: { title: 'Revision fixture', slug: randomUUID() } })).id
})
afterEach(async () => { await prisma.article.deleteMany({ where: { id: { in: ids.splice(0) } } }) })
afterAll(async () => { if (seriesId) await prisma.series.delete({ where: { id: seriesId } }); await prisma.$disconnect() })
async function fixture(status: ArticleStatus = 'DRAFT') {
  const article = await prisma.article.create({ data: {
    title: 'Loaded title', slug: randomUUID(), content: 'Loaded content', authorId, status,
    ...(status === 'SCHEDULED' ? { scheduledAt: new Date('2099-01-01T12:00:00Z') } : {}),
  } })
  ids.push(article.id)
  return article
}
async function send(id: string, body: Record<string, unknown>, endpoint = '', method = 'PUT', header = false) {
  return fetch(`${base}${endpoint || '/api/articles/'}${id}${endpoint.includes('/articles/') ? '/review' : ''}`, {
    method, headers: { 'content-type': 'application/json', cookie: session.cookieHeader,
      ...(header ? { 'x-article-revision': body.expectedUpdatedAt as string } : {}),
    }, body: method === 'DELETE' ? undefined : JSON.stringify(body),
  })
}
async function newer(id: string) {
  return prisma.article.update({ where: { id }, data: { title: 'Newer title', content: 'Newer content', updatedAt: new Date(Date.now() + 100) } })
}
describe('first-party loaded article revisions over real HTTP and PostgreSQL', () => {
  it.each([
    ['editor save', 'DRAFT', { title: 'Stale title', content: 'Stale content' }],
    ['list publish', 'DRAFT', { status: 'PUBLISHED' }],
    ['list unpublish', 'PUBLISHED', { status: 'DRAFT' }],
    ['series assignment', 'PUBLISHED', { seriesOrder: 2 }],
  ] as const)('%s rejects stale page and preserves newer row', async (_label, status, fields) => {
    const loaded = await fixture(status)
    const current = await newer(loaded.id)
    const res = await send(loaded.id, { ...fields, ...(_label === 'series assignment' ? { seriesId } : {}), expectedUpdatedAt: loaded.updatedAt.toISOString() })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ARTICLE_CHANGED' })
    expect(await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(current)
  })
  it('current save, publish, unpublish and series assignment propagate each returned revision', async () => {
    const loaded = await fixture()
    let revision = loaded.updatedAt.toISOString()
    for (const fields of [{ title: 'Saved title' }, { status: 'PUBLISHED' }, { seriesId, seriesOrder: 1 }, { status: 'DRAFT' }]) {
      const res = await send(loaded.id, { ...fields, publicationIntent: true, expectedUpdatedAt: revision })
      expect(res.status).toBe(200)
      const saved = await res.json()
      expect(saved).toMatchObject(fields)
      expect(saved.updatedAt).not.toBe(revision)
      revision = saved.updatedAt
      expect((await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).updatedAt.toISOString()).toBe(revision)
    }
  })
  it.each(['approve', 'return', 'schedule', 'correct', 'unpublish'])('review %s rejects stale displayed content', async action => {
    const loaded = await fixture(['correct', 'unpublish'].includes(action) ? 'PUBLISHED' : 'PENDING_REVIEW')
    const current = await newer(loaded.id)
    const res = await send(loaded.id, { action, scheduledAt: '2099-01-01T12:00', note: 'Stale feedback', corrected: true, expectedUpdatedAt: loaded.updatedAt.toISOString() }, '/api/editorial/articles/', 'PATCH')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ARTICLE_CHANGED' })
    expect(await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(current)
    expect(await prisma.notification.count({ where: { articleId: loaded.id } })).toBe(0)
  })
  it.each(['approve', 'return', 'schedule', 'correct', 'unpublish'])('review %s succeeds at the displayed revision and preserves content', async action => {
    const loaded = await fixture(['correct', 'unpublish'].includes(action) ? 'PUBLISHED' : 'PENDING_REVIEW')
    const res = await send(loaded.id, { action, note: 'Sourcing feedback', scheduledAt: '2099-01-01T12:00', corrected: true, correctionNote: 'Clarified figures', expectedUpdatedAt: loaded.updatedAt.toISOString() }, '/api/editorial/articles/', 'PATCH')
    expect(res.status).toBe(200)
    const saved = await res.json()
    const row = await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })
    expect(row.updatedAt.toISOString()).toBe(saved.updatedAt)
    expect(row.content).toBe(loaded.content)
    expect(row.status).toBe(({ approve: 'PUBLISHED', return: 'REJECTED', schedule: 'SCHEDULED', correct: 'PUBLISHED', unpublish: 'DRAFT' } as Record<string, string>)[action])
    if (action === 'correct') expect(row).toMatchObject({ corrected: true, correctionNote: 'Clarified figures' })
    if (action === 'return') expect(row.editorNote).toBe('Sourcing feedback')
    if (action === 'schedule') expect(row.scheduledAt!.toISOString()).toBe('2099-01-01T12:00:00.000Z')
    expect(await prisma.notification.count({ where: { articleId: loaded.id } })).toBe(action === 'correct' ? 0 : 1)
  })
  it('concurrent valid approvals commit exactly one transition and notification', async () => {
    const loaded = await fixture('PENDING_REVIEW')
    const responses = await Promise.all(Array.from({ length: 5 }, () => send(loaded.id, { action: 'approve', expectedUpdatedAt: loaded.updatedAt.toISOString() }, '/api/editorial/articles/', 'PATCH')))
    expect(responses.filter(res => res.status === 200)).toHaveLength(1)
    expect(responses.filter(res => res.status === 409)).toHaveLength(4)
    const saved = await responses.find(res => res.status === 200)!.json()
    expect((await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).updatedAt.toISOString()).toBe(saved.updatedAt)
    expect(saved.status).toBe('PUBLISHED')
    expect(await prisma.notification.count({ where: { articleId: loaded.id, type: 'approve' } })).toBe(1)
  })
  it('concurrent choices retain exactly one global featured article', async () => {
    for (let round = 0; round < 3; round++) {
      const articles = await Promise.all(Array.from({ length: 4 }, () => fixture('PUBLISHED')))
      const responses = await Promise.all(articles.map(article => fetch(`${base}/api/editorial/articles/${article.id}/feature`, {
        method: 'POST', headers: { cookie: session.cookieHeader, 'x-article-revision': article.updatedAt.toISOString() },
      })))
      expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200])
      const featured = await prisma.article.findMany({ where: { isFeatured: true } })
      expect(featured).toHaveLength(1)
      expect(articles.map(article => article.id)).toContain(featured[0].id)
      expect(featured[0].content).toBe('Loaded content')
    }
  })
  it.each(['commendation', 'calendar', 'delete', 'pin', 'feature'])('%s rejects stale state and succeeds with current revision', async action => {
    const loaded = await fixture(action === 'calendar' ? 'SCHEDULED' : 'PUBLISHED')
    const current = await newer(loaded.id)
    const mutate = async (revision: string) => {
      const endpoint = action === 'calendar' ? '/api/editorial/calendar' : action === 'delete' ? `/api/articles/${loaded.id}` : `/api/editorial/articles/${loaded.id}/${action}`
      return fetch(base + endpoint, { method: action === 'delete' ? 'DELETE' : ['pin', 'feature'].includes(action) ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookieHeader, 'x-article-revision': revision },
        ...(action === 'delete' ? {} : { body: JSON.stringify({ expectedUpdatedAt: revision, articleId: loaded.id, date: '2099-01-02', commendation: 'Well sourced' }) }),
      })
    }
    expect((await mutate(loaded.updatedAt.toISOString())).status).toBe(409)
    expect(await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(current)
    expect((await mutate(current.updatedAt.toISOString())).status).toBe(200)
    const saved = await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })
    expect(saved.content).toBe('Newer content')
    if (action === 'delete') expect(saved.deletedAt).not.toBeNull()
    if (action === 'commendation') expect(saved.editorialCommendation).toBe('Well sourced')
    if (action === 'calendar') expect(saved.scheduledAt!.toISOString()).toBe('2099-01-02T12:00:00.000Z')
    if (action === 'pin') expect(saved.isPinned).toBe(true)
    if (action === 'feature') expect(saved.isFeatured).toBe(true)
    if (['pin', 'feature'].includes(action)) {
      const remove = (revision: string) => fetch(`${base}/api/editorial/articles/${loaded.id}/${action}`, { method: 'DELETE', headers: { cookie: session.cookieHeader, 'x-article-revision': revision } })
      expect((await remove(loaded.updatedAt.toISOString())).status).toBe(409)
      expect(await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })).toEqual(saved)
      const response = await remove(saved.updatedAt.toISOString())
      expect(response.status).toBe(200)
      const result = await response.json()
      const removed = await prisma.article.findUniqueOrThrow({ where: { id: loaded.id } })
      expect(removed.updatedAt.toISOString()).toBe(result.updatedAt)
      expect(action === 'pin' ? removed.isPinned : removed.isFeatured).toBe(false)
    }
  })
})
