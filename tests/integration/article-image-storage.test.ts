import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  removeUnreferencedArticleImage,
  queueArticleImageCleanup,
  collectUnusedArticleImages,
  lockArticleImages,
} from '@/lib/articleImageStorage'
let userId: string
let articleId: string
let url: string
const token = randomUUID()
beforeAll(async () => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base?.startsWith('http://127.0.0.1:'))
    throw new Error('Local Storage emulator required; no external storage allowed')
  userId = (await prisma.user.create({ data: { email: `${token}@example.test`, role: 'WRITER' } }))
    .id
  const path = `${userId}/${randomUUID()}.png`
  const result = await fetch(`${base}/storage/v1/object/article-images/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer local-service-key', 'content-type': 'image/png' },
    body: Buffer.from('test-only-storage-fixture'),
  })
  expect(result.ok).toBe(true)
  url = `${base}/storage/v1/object/public/article-images/${path}`
  await prisma.articleImageAsset.create({ data: { url, path, uploaderId: userId } })
  articleId = (
    await prisma.article.create({
      data: {
        title: token,
        slug: token,
        authorId: userId,
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'figure', attrs: { src: url } }],
        }),
      },
    })
  ).id
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { id: articleId } })
  await prisma.articleImageAsset.deleteMany({ where: { uploaderId: userId } })
  await prisma.user.delete({ where: { id: userId } })
})
describe('reference-safe image cleanup', () => {
  it('refuses foreign ownership and retains draft/trash references', async () => {
    expect(await removeUnreferencedArticleImage(url, 'other')).toBe('unmanaged')
    expect(await removeUnreferencedArticleImage(url, userId)).toBe('retained')
    await prisma.article.update({ where: { id: articleId }, data: { deletedAt: new Date() } })
    expect(await removeUnreferencedArticleImage(url, userId)).toBe('retained')
    expect((await fetch(url)).ok).toBe(true)
  })
  it('defers cleanup and restores the original reference during the grace period', async () => {
    await prisma.$transaction(async (tx) => {
      await lockArticleImages(tx, JSON.stringify({ type: 'figure', attrs: { src: url } }), null)
    })
    await prisma.article.update({ where: { id: articleId }, data: { content: '{}' } })
    await queueArticleImageCleanup(url, userId)
    expect(
      (await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince
    ).not.toBeNull()
    expect(await collectUnusedArticleImages()).toBe(0)
    expect((await fetch(url)).ok).toBe(true)
    await prisma.$transaction(async (tx) => {
      await lockArticleImages(tx, JSON.stringify({ type: 'figure', attrs: { src: url } }), null)
      await tx.article.update({
        where: { id: articleId },
        data: { content: JSON.stringify({ type: 'figure', attrs: { src: url } }) },
      })
    })
    expect(
      (await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince
    ).toBeNull()
  })
  it.each([
    'slashes',
    'unicode',
    'query',
    'encoded',
    'encoded filename',
    'cover',
    'legacy HTML',
    'URL-normalised path',
  ])(
    'retains references with %s representation and canonicalises save locks',
    async (representation) => {
      const variant =
        representation === 'encoded'
          ? url.replace('/article-images/', '/article%2Dimages%2F')
          : representation === 'encoded filename'
            ? url.replace('.png', '%2Epng')
            : representation === 'URL-normalised path'
              ? url.replace('/article-images/', '/article-images/temporary/../')
              : `${url}?download=1#image`
      let content = JSON.stringify({ type: 'figure', attrs: { src: variant } })
      if (representation === 'slashes') content = content.replace(/\//g, '\\/')
      if (representation === 'unicode')
        content = content.replace(/[a-z0-9]/g, (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
        )
      if (representation === 'legacy HTML') content = `<p><img src="${variant}" /></p>`
      await prisma.article.update({
        where: { id: articleId },
        data: {
          content: representation === 'cover' ? '{}' : content,
          coverImage: representation === 'cover' ? variant : null,
        },
      })
      await prisma.$transaction((tx) =>
        lockArticleImages(tx, JSON.stringify({ type: 'figure', attrs: { src: variant } }), null)
      )
      await queueArticleImageCleanup(variant, userId)
      expect(
        (await prisma.articleImageAsset.findUniqueOrThrow({ where: { url } })).unusedSince
      ).toBeNull()
      expect(await removeUnreferencedArticleImage(variant, userId)).toBe('retained')
      expect((await fetch(url)).ok).toBe(true)
      await prisma.article.update({ where: { id: articleId }, data: { coverImage: null } })
    }
  )
  it('only removes a managed image after its last stored reference disappears', async () => {
    await prisma.article.update({ where: { id: articleId }, data: { content: '{}' } })
    await queueArticleImageCleanup(url, userId)
    await prisma.articleImageAsset.update({
      where: { url },
      data: { unusedSince: new Date(Date.now() - 31 * 86400000) },
    })
    expect(await collectUnusedArticleImages()).toBeGreaterThanOrEqual(1)
    await expect(
      prisma.$transaction((tx) =>
        lockArticleImages(tx, JSON.stringify({ type: 'figure', attrs: { src: url } }), null)
      )
    ).rejects.toThrow('no longer available')
    expect((await fetch(url)).status).toBe(404)
    expect(await removeUnreferencedArticleImage('/legacy.png', userId)).toBe('unmanaged')
  })
})
