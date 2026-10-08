import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE } from './helpers/authStorage'
import { pinnedContext } from './helpers/pinnedContext'

test.use({ storageState: ADMIN_STORAGE })

test('warm category list follows create, edit, unpublish, republish, trash and restore', async ({ page, browser }) => {
  const context = await pinnedContext(browser, { storageState: ADMIN_STORAGE })
  const request = context.request
  let id: string | undefined
  try {
    const existing = await request.get('/api/articles?category=news&take=1')
    expect(existing.status()).toBe(200)
    const [seed] = await existing.json()
    expect(seed?.category?.id, 'seeded News category is required').toBeTruthy()
    const path = `/category/${seed.category.slug}`
    const title = `Cache foundation ${Date.now()}-${test.info().workerIndex}`
    let currentTitle = title
    const heading = () => page.getByRole('heading', { name: currentTitle, exact: true })

    // Warm the actual Next data cache BEFORE a direct published create.
    await page.goto(path)
    await expect(heading()).toHaveCount(0)
    const created = await request.post('/api/articles', {
      data: {
        title, categoryId: seed.category.id, status: 'PUBLISHED',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cache contract.' }] }] }),
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    id = (await created.json()).id
    expect(id).toBeTruthy()
    await page.reload()
    await expect(heading()).toBeVisible()

    currentTitle = `${title} revised`
    expect((await request.put(`/api/articles/${id}`, { data: { title: currentTitle } })).status()).toBe(200)
    await page.reload()
    await expect(heading()).toBeVisible()

    expect((await request.patch(`/api/editorial/articles/${id}/review`, { data: { action: 'unpublish' } })).status()).toBe(200)
    await page.reload()
    await expect(heading()).toHaveCount(0)

    expect((await request.put(`/api/articles/${id}`, { data: { status: 'PUBLISHED', publicationIntent: true } })).status()).toBe(200)
    await page.reload()
    await expect(heading()).toBeVisible()

    expect((await request.delete(`/api/articles/${id}`)).status()).toBe(200)
    await page.reload()
    await expect(heading()).toHaveCount(0)

    expect((await request.patch(`/api/editorial/trash/${id}`)).status()).toBe(200)
    await page.reload()
    await expect(heading()).toBeVisible()
  } finally {
    // Delete only this scenario's own synthetic article, through the real APIs.
    try {
      if (id) {
        await request.delete(`/api/articles/${id}`)
        await request.delete(`/api/editorial/trash/${id}`)
      }
    } finally { await context.close() }
  }
})
