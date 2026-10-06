import { test, expect } from '@playwright/test'
import { ArticleEditorPage } from './helpers/workflow'
import { WRITER_STORAGE } from './helpers/authStorage'

/**
 * The article editor must fit the screen on common desktop and laptop widths: the
 * document sits fully to the right of the portal sidebar, the settings panel is fully
 * on screen, and nothing needs a horizontal scrollbar. (At 1280 px the document used to
 * start 100 px under the sidebar, hiding the first letters of every line, and the
 * settings panel hung off the right edge.)
 */
for (const width of [1100, 1280, 1366, 1440, 1920]) {
  test(`editor fits a ${width}px-wide window`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: WRITER_STORAGE, viewport: { width, height: 800 } })
    const page = await ctx.newPage()
    const ed = new ArticleEditorPage(page)
    await ed.openNew()

    const m = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect()
      const sidebar = document.querySelector('nav[aria-label="Editorial navigation"]')!.closest('aside')!
      const panel = [...document.querySelectorAll('aside')].find((a) => a.querySelector('input[placeholder^="Add a tag"]'))!
      const doc = document.querySelector('textarea[placeholder="Your headline here..."]')!.closest('div.border')!
      const scroller = document.querySelector('[data-editorial-scroll-region]') as HTMLElement
      return {
        sidebarRight: box(sidebar).right,
        docLeft: box(doc).left,
        docWidth: box(doc).width,
        panelRight: box(panel).right,
        inner: window.innerWidth,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      }
    })
    expect(m.docLeft, 'document starts under the sidebar').toBeGreaterThanOrEqual(m.sidebarRight - 1)
    expect(m.panelRight, 'settings panel runs off the right edge').toBeLessThanOrEqual(m.inner + 1)
    expect(m.scrollWidth, 'editor needs a horizontal scrollbar').toBeLessThanOrEqual(m.clientWidth + 1)
    expect(m.docWidth, 'document too narrow to write in').toBeGreaterThan(480)

    // The first letters of the headline are really on screen, not hidden under the sidebar.
    const title = ed.title()
    await title.fill('Headline that must be readable')
    const left = await title.evaluate((el) => el.getBoundingClientRect().left)
    expect(left).toBeGreaterThanOrEqual(m.sidebarRight)
    await ctx.close()
  })
}
