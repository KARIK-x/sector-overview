const { chromium } = require('playwright')
const fs = require('fs')
const BASE = 'http://127.0.0.1:8000'
let pass = 0, fail = 0
async function check(name, fn) { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message) } }
async function pageAt(route) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  return { browser, page, errors }
}
async function dl(page, loc) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), loc.click()])
  const p = await d.path(); const size = p ? fs.statSync(p).size : 0
  if (!size) throw new Error('empty ' + d.suggestedFilename())
  return size
}
;(async () => {
  for (const [r, re] of [['/', /by sector/i], ['/rotation', /two axes/i], ['/compare', /one scale/i], ['/breadth', /broad|narrow/i], ['/liquidity', /Trading value/i], ['/risk', /shape of the path/i], ['/fundamentals', /Earnings, not narratives/i], ['/sectors', /One sector/i], ['/research', /seams/i], ['/data-quality', /dataset property/i], ['/events', /calendar/i], ['/methodology', /Every number/i]]) {
    const { browser, page, errors } = await pageAt(r)
    await check(`chrome ${r} renders`, async () => {
      const h = await page.locator('h1').innerText()
      if (!re.test(h)) throw new Error(h)
      const charts = await page.locator('.chart-frame').count()
      if (!charts && r !== '/events' && r !== '/methodology' && r !== '/data-quality' && r !== '/nope') throw new Error('no charts')
    })
    await check(`chrome ${r} no console errors`, async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/rotation')
    await page.getByRole('tab', { name: '60', exact: true }).click()
    await page.waitForTimeout(700)
    await check('chrome rotation lookback + CSV + PNG', async () => {
      const t = await page.locator('text=/ABSOLUTE VS RELATIVE/i').first().innerText()
      if (!/60 SESSIONS/i.test(t)) throw new Error(t)
      const csv = await dl(page, page.getByRole('button', { name: 'CSV', exact: true }).first())
      const png = await dl(page, page.locator('button[aria-label^="Export"]').first())
      if (!csv || !png) throw new Error('empty export')
    })
    await check('chrome rotation no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/compare')
    await page.getByRole('tab', { name: '1Y', exact: true }).click()
    await page.waitForTimeout(600)
    await check('chrome compare preset + CSV', async () => {
      const v = await page.locator('input[type=date]').first().inputValue()
      if (!v) throw new Error('no date')
      await dl(page, page.getByRole('button', { name: 'CSV', exact: true }))
    })
    await check('chrome compare no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/sectors')
    await page.getByRole('button', { name: 'Finance', exact: true }).first().click()
    await page.getByText('Participation inside Finance').waitFor({ timeout: 12000 })
    await check('chrome sector switch', async () => {})
    await check('chrome sector no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const browser = await chromium.launch({ channel: 'chrome' })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await check('chrome mobile no horizontal overflow', async () => {
      const x = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      if (x.s !== x.c) throw new Error(JSON.stringify(x))
    })
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('link', { name: 'Rotation Lab' }).click()
    await page.waitForTimeout(700)
    await check('chrome mobile drawer navigates', async () => { if (!/\/rotation$/.test(page.url())) throw new Error(page.url()) })
    await check('chrome mobile no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  {
    const { browser, page, errors } = await pageAt('/')
    await page.keyboard.press('Meta+k')
    await page.getByPlaceholder('Jump to a page or sector…').fill('risk')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    await check('chrome command palette', async () => { if (!/\/risk$/.test(page.url())) throw new Error(page.url()) })
    await page.getByRole('button', { name: /Switch to dark theme/ }).click()
    await check('chrome dark theme', async () => { const c = await page.locator('html').getAttribute('class'); if (!/dark/.test(c || '')) throw new Error(String(c)) })
    await check('chrome layout no errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }
  console.log('\nCHROME SUMMARY', { pass, fail })
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
