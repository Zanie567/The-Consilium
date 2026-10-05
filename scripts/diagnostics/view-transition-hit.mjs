import { chromium, webkit } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const results = []

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch()
  try {
    for (const variant of ['default', 'overlay-pointer-none', 'root-disabled']) {
      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setContent(`
        <style>
          button { position: absolute; top: 100px; left: 100px; width: 200px; height: 70px }
          ::view-transition-group(root) { animation-duration: 3s }
          ${variant === 'overlay-pointer-none' ? '::view-transition { pointer-events: none }' : ''}
          ${variant === 'root-disabled' ? 'html { view-transition-name: none }' : ''}
        </style>
        <button onclick="window.clicked++">Actual control</button>
        <script>
          window.clicked = 0
          window.transition = document.startViewTransition(
            () => { document.body.dataset.phase = 'new' }
          )
        </script>
      `)
      await page.evaluate(() => window.transition.ready)
      const button = page.getByRole('button', { name: 'Actual control' })
      const box = await button.boundingBox()
      assert(box, `${engineName} ${variant}: control has no bounding box`)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      results.push({
        engine: engineName,
        variant,
        clicks: await page.evaluate(() => window.clicked),
        errors,
      })
      await page.evaluate(() => window.transition.skipTransition())
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

// What each engine really does while a view transition runs (measured with Playwright's pinned browsers,
// the same on macOS and CI): Chromium delivers no click to the page in any variant, not even with the
// overlay's pointer-events disabled or the root's view-transition-name removed; WebKit delivers it only
// when the root is excluded from the transition. Either way a click during a transition is lost, which
// is why the application no longer starts view transitions.
const expectedClicks = (engine, variant) => (engine === 'webkit' && variant === 'root-disabled' ? 1 : 0)

for (const result of results) {
  assert.deepEqual(result.errors, [], `${result.engine} ${result.variant}: page errors`)
  assert.equal(
    result.clicks,
    expectedClicks(result.engine, result.variant),
    `${result.engine} ${result.variant}: native click result`,
  )
}

await fs.writeFile(
  'test-results/view-transition-hit-probe.json',
  JSON.stringify({
    method: 'Framework-free native hit-testing reproduction; not an application workflow result',
    results,
  }, null, 2) + '\n',
)
console.log(`Verified ${results.length} native view-transition hit-testing cases`)
