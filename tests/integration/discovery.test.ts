import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { discoveryWhere } from '@/lib/discoveryQueries'
import { resolveArticleTag } from '@/lib/resolveArticleTag'
import { randomUUID } from 'node:crypto'
const prefix = `discovery-${randomUUID()}`
let authorId: string
let categoryId: string
const articleIds: string[] = []
const tagIds: string[] = []
beforeAll(async () => {
  authorId = (await prisma.user.create({ data: { name: prefix, email: `${prefix}@example.test`, role: 'WRITER' } })).id
  categoryId = (await prisma.category.create({ data: { name: prefix, slug: prefix } })).id
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } })
  await prisma.tag.deleteMany({ where: { id: { in: tagIds } } })
  await prisma.category.delete({ where: { id: categoryId } })
  await prisma.user.delete({ where: { id: authorId } })
})
describe('topic persistence and filtering on isolated Postgres', () => {
  it('reuses legacy slug/id, even under simultaneous normalised assignments', async () => {
    const legacy = await prisma.tag.create({ data: { name: `${prefix} Investment & Finance`, slug: `${prefix}--finance-legacy` } })
    tagIds.push(legacy.id)
    const topic = { name: `${prefix} investment finance`, slug: `${prefix}-investment-finance` }
    const results = await Promise.all([1, 2, 3].map(() => prisma.$transaction(tx => resolveArticleTag(tx, topic))))
    expect(results.map(t => t.id)).toEqual([legacy.id, legacy.id, legacy.id])
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: legacy.id } })).slug).toBe(legacy.slug)
    await expect(prisma.tag.create({ data: { name: `  ${prefix} INVESTMENT FINANCE `, slug: `${prefix}-other-url` } })).rejects.toThrow()
  })
  it('keeps unrelated historical slug collisions separate and preserves both URLs', async () => {
    const name=`${prefix} Distinct Topic`, slug=`${prefix}-distinct-topic`
    const legacy=await prisma.tag.create({data:{name:`${prefix} Different Historical Name`,slug}})
    tagIds.push(legacy.id)
    const assigned=await prisma.$transaction(tx=>resolveArticleTag(tx,{name,slug}))
    tagIds.push(assigned.id)
    expect(assigned.id).not.toBe(legacy.id)
    expect((await prisma.tag.findUniqueOrThrow({where:{id:legacy.id}})).slug).toBe(slug)
    expect((await prisma.tag.findUniqueOrThrow({where:{id:assigned.id}})).slug).toMatch(new RegExp(`^${slug}-[a-f0-9]{10}$`))
    expect(await prisma.$transaction(tx=>resolveArticleTag(tx,{name:name.toUpperCase(),slug}))).toEqual(assigned)
  })
  it('relates multiple topics without duplicates and combines with format/search', async () => {
    const topics = await Promise.all(['Politics', 'History'].map(name => prisma.tag.create({ data: { name: `${prefix} ${name}`, slug: `${prefix}-${name.toLowerCase()}` } })))
    tagIds.push(...topics.map(t => t.id))
    for (let i = 0; i < 3; i++) {
      const a = await prisma.article.create({ data: { title: `${prefix} ${i}`, slug: `${prefix}-${i}`, content: '{}', authorId,
        categoryId: i === 2 ? null : categoryId, status: 'PUBLISHED', tags: { create: topics.slice(0, i === 1 ? 2 : 1).map(t => ({ tagId: t.id })) } } })
      articleIds.push(a.id)
    }
    const rows = await prisma.article.findMany({ where: discoveryWhere(prefix, prefix, topics.map(t => t.slug)), select: { id: true } })
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(a => a.id)).size).toBe(2)
    expect(await prisma.article.count({ where: discoveryWhere('not-a-result', prefix, topics.map(t => t.slug)) })).toBe(0)
    await expect(prisma.tag.delete({ where: { id: topics[0].id } })).rejects.toThrow()
    await prisma.tag.update({ where: { id: topics[0].id }, data: { name: `${prefix} Renamed Topic` } })
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: topics[0].id } })).slug).toBe(topics[0].slug)
    expect(await prisma.articleTag.count({ where: { tagId: topics[0].id } })).toBe(3)
    expect(await prisma.$transaction(tx => resolveArticleTag(tx, { name: `${prefix} Renamed Topic`, slug: `${prefix}-renamed-topic` }))).toEqual({ id: topics[0].id })
  })
})
