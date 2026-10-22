const { firefox } = require('playwright')
const fs = require('fs')
const BASE = 'http://127.0.0.1:8000'
let pass = 0, fail = 0
async function check(n, f) { try { await f(); pass++; console.log('PASS', n) } catch (e) { fail++; console.log('FAIL', n, '-', e.message) } }
async function pageAt(route) {
  const browser = await firefox.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  return { browser, page, errors }
}
async function saveDownload(page, loc, name) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), loc.click()])
  const p = await d.path()
  const dest = `/tmp/nsi-${name}`
  if (p) fs.copyFileSync(p, dest)
  return dest
}
;(async () => {
  {
    const { browser, page, errors } = await pageAt('/rotation')
    // select Hydro Power from the table
    await page.locator('table.data-table').first().getByRole('button', { name: 'Hydro Power', exact: true }).click().catch(async () => {
      await page.locator('table.data-table').first().locator('tbody tr', { hasText: 'Hydro Power' }).click()
    })
    await page.waitForTimeout(800)
    await check('rotation table selects sector', async () => {
      const t = await page.locator('main').innerText()
      if (!/Hydro Power/.test(t)) throw new Error('no hydro')
      if (!/Open full sector/.test(t)) throw new Error('selected panel missing')
    })
    await page.getByRole('tab', { name: '25', exact: true }).click()
    await page.waitForTimeout(900)
    await check('rotation trail 25 keeps chart', async () => {
      const n = await page.locator('.chart-frame').count()
      if (n < 2) throw new Error('charts ' + n)
    })
    await page.getByRole('button', { name: /Reset zoom/i }).click()
    await page.waitForTimeout(400)
    await check('rotation zoom reset control', async () => {
      if (!(await page.locator('text=/Scroll or pinch/i').first().isVisible())) throw new Error('caption missing')
    })
    const csv = await saveDownload(page, page.getByRole('button', { name: 'CSV', exact: true }).first(), 'rotation.csv')
    await check('rotation CSV structure', async () => {
      const lines = fs.readFileSync(csv, 'utf8').trim().split('\n')
      if (lines.length < 13) throw new Error('rows ' + lines.length)
      if (!/^Sector/i.test(lines[0])) throw new Error('header ' + lines[0])
      console.log('  rotation rows', lines.length, 'header', lines[0].slice(0, 100))
    })
    await check('rotation no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/breadth')
    const chip = page.getByRole('button', { name: 'Commercial Banks', exact: true }).first()
    await chip.click()
    await check('breadth sector deep dive', async () => {
      await page.getByText('Members above their own moving average').waitFor({ timeout: 12000 })
      if (!(await page.getByRole('button', { name: 'Clear', exact: true }).isVisible())) throw new Error('clear control missing')
    })
    await check('breadth no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/fundamentals')
    await page.locator('table.data-table').first().getByRole('button', { name: 'Finance', exact: true }).click()
    await page.waitForTimeout(900)
    await check('fundamentals table selects sector', async () => {
      const h = await page.locator('text=/Member detail/i').first().count()
      if (!h) throw new Error('no member detail')
      const txt = await page.locator('main').innerText()
      if (!/Finance/.test(txt)) throw new Error('no Finance')
    })
    const csv = await saveDownload(page, page.getByRole('button', { name: 'CSV', exact: true }).first(), 'fundamentals.csv')
    await check('fundamentals CSV structure', async () => {
      const lines = fs.readFileSync(csv, 'utf8').trim().split('\n')
      if (lines.length !== 14) throw new Error('rows ' + lines.length)
      if (!/^sector,coverage,net_profit_npr/.test(lines[0])) throw new Error('header ' + lines[0])
      console.log('  fundamentals rows', lines.length)
    })
    await check('fundamentals no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/data-quality')
    await page.getByRole('button', { name: /Re-check/i }).click()
    await page.waitForTimeout(1800)
    await check('data quality re-check completes', async () => {
      if (!(await page.getByText(/Ingestion runs/i).first().isVisible())) throw new Error('page missing')
    })
    await check('data quality no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/compare')
    const csv = await saveDownload(page, page.getByRole('button', { name: 'CSV', exact: true }), 'compare.csv')
    await check('compare CSV structure', async () => {
      const lines = fs.readFileSync(csv, 'utf8').trim().split('\n')
      if (lines.length !== 5) throw new Error('rows ' + lines.length)
      if (!/^Series/i.test(lines[0])) throw new Error('header ' + lines[0])
      console.log('  compare rows', lines.length, 'header', lines[0].slice(0, 100))
    })
    const png = await saveDownload(page, page.locator('button[aria-label^="Export"]').first(), 'compare.png')
    await check('compare PNG header', async () => {
      const b = fs.readFileSync(png)
      if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not png')
      const w = b.readUInt32BE(16), hh = b.readUInt32BE(20)
      if (w < 500 || hh < 300) throw new Error(`${w}x${hh}`)
      console.log('  png', `${w}x${hh}`, b.length)
    })
    await check('compare no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  console.log('\nEXTRA SUMMARY', { pass, fail })
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
