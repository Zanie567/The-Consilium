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

for (const result of results) {
  assert.deepEqual(result.errors, [], `${result.engine} ${result.variant}: page errors`)
}

await fs.writeFile(
  'test-results/view-transition-hit-probe.json',
  JSON.stringify({
    method: 'Framework-free exploratory hit-testing reproduction; click delivery varies with engine and timing and is not an application workflow result',
    results,
  }, null, 2) + '\n',
)
console.log(`Recorded ${results.length} native view-transition hit-testing cases`)
