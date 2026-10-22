// Supplemental evidence: enriched rotation tooltip, wheel zoom + reset, and the
// breadth/liquidity CSV exports. Run against the production build on :8000.
const { firefox } = require('playwright')
const crypto = require('crypto')
const fs = require('fs')

const BASE = 'http://127.0.0.1:8000'
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')

;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  let pass = 0
  const ok = (label, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} extras ${label}${detail ? ` — ${detail}` : ''}`)
    if (cond) pass += 1
    else process.exitCode = 1
  }

  await page.goto(BASE + '/rotation', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  const frame = page
    .locator('.chart-frame')
    .filter({ has: page.locator('button[aria-label^="Export nepse-rotation"]') })
    .first()
  const canvas = frame.locator('canvas').first()
  const box = await canvas.boundingBox()

  // Scan plot positions until the enriched ECharts tooltip appears. The label
  // "Advancing members" exists only in the rotation tooltip, not the table.
  let tooltip = false
  outer: for (const fy of [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) {
    for (const fx of [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
      await page.waitForTimeout(120)
      const label = page.getByText('Advancing members', { exact: false })
      if ((await label.count()) && (await label.first().isVisible().catch(() => false))) {
        const text = await frame.innerText()
        tooltip = /Advancing members/.test(text) && /Turnover HHI/.test(text) && /RS ratio/i.test(text)
        break outer
      }
    }
  }
  ok('rotation tooltip enriched', tooltip)

  await page.mouse.move(10, 10)
  await page.waitForTimeout(400)
  const shot = async () => md5(await page.screenshot({ clip: box }))
  const before = await shot()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(900)
  await page.mouse.move(10, 10)
  await page.waitForTimeout(400)
  const zoomed = await shot()
  ok('wheel zoom changes the map', before !== zoomed)
  await page.getByRole('button', { name: /Reset zoom/i }).click()
  await page.waitForTimeout(900)
  const reset = await shot()
  ok('reset restores the map', reset === before)

  for (const [route, prefix] of [['/breadth', 'nepse-breadth'], ['/liquidity', 'nepse-liquidity']]) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /CSV/i }).first().click(),
    ])
    const file = await dl.path()
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
    const header = lines[0]
    ok(
      `${route} CSV`,
      dl.suggestedFilename().startsWith(prefix) &&
        lines.length >= 12 &&
        header.includes('Sector') &&
        header.includes(route === '/breadth' ? 'Advances' : 'Turnover'),
      `${lines.length} lines`,
    )
  }
  ok('no console or page errors', errors.length === 0, errors.join(' | '))
  console.log(`\nEXTRAS SUMMARY { pass: ${pass}, fail: ${6 - pass} }`)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
