const { firefox } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:8000'
let pass = 0, fail = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (e) {
    fail++
    failures.push(`${name}: ${e.message}`)
    console.log('FAIL', name, '-', e.message)
  }
}

async function newPage(route) {
  const browser = await firefox.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1300)
  return { browser, context, page, errors }
}

async function downloadOf(page, locator) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    locator.click(),
  ])
  const p = await download.path()
  const size = p ? fs.statSync(p).size : 0
  if (!size) throw new Error(`empty download (${download.suggestedFilename()})`)
  return { name: download.suggestedFilename(), size }
}

(async () => {
  // ---------- Compare ----------
  {
    const { browser, page, errors } = await newPage('/compare')
    const h = await page.locator('h1').innerText()
    await check('compare heading', async () => { if (!/Put the sectors on one scale/.test(h)) throw new Error(h) })
    await page.getByRole('tab', { name: '1Y', exact: true }).click()
    await page.waitForTimeout(500)
    await check('compare 1Y preset updates from date', async () => {
      const v = await page.locator('input[type=date]').first().inputValue()
      const d = new Date(); d.setFullYear(d.getFullYear() - 1)
      const p = (n) => String(n).padStart(2, '0')
      const want = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      if (v !== want) throw new Error(`${v} != ${want}`)
    })
    await page.getByRole('tab', { name: '5Y', exact: true }).click()
    await page.waitForTimeout(600)
    await check('compare 5Y selected', async () => {
      const sel = await page.getByRole('tab', { name: '5Y', exact: true }).getAttribute('aria-selected')
      if (sel !== 'true') throw new Error('5Y not selected')
    })
    await page.getByRole('tab', { name: 'Return %', exact: true }).click()
    await page.waitForTimeout(400)
    await check('compare return mode selected', async () => {
      const sel = await page.getByRole('tab', { name: 'Return %', exact: true }).getAttribute('aria-selected')
      if (sel !== 'true') throw new Error('not selected')
    })
    const chip = page.getByRole('button', { name: 'Commercial Banks', exact: true })
    await chip.click()
    await page.waitForTimeout(500)
    await check('compare chip toggles series off', async () => {
      const pressed = await chip.getAttribute('aria-pressed')
      if (pressed !== 'false') throw new Error(`pressed=${pressed}`)
      const txt = await page.locator('text=/\\d+ series selected/').innerText()
      if (!/3 series selected/.test(txt)) throw new Error(txt)
    })
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.waitForTimeout(500)
    await check('compare reset restores defaults', async () => {
      const pressed = await chip.getAttribute('aria-pressed')
      if (pressed !== 'true') throw new Error(`pressed=${pressed}`)
      const sel = await page.getByRole('tab', { name: '3Y', exact: true }).getAttribute('aria-selected')
      if (sel !== 'true') throw new Error('3Y not restored')
    })
    await check('compare CSV download', async () => {
      const d = await downloadOf(page, page.getByRole('button', { name: 'CSV', exact: true }))
      console.log('  csv', d.name, d.size)
      if (!/\.csv$/.test(d.name)) throw new Error(d.name)
    })
    await check('compare PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('compare no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Rotation ----------
  {
    const { browser, page, errors } = await newPage('/rotation')
    await check('rotation heading', async () => {
      const h = await page.locator('h1').innerText()
      if (!/Strength has two axes/.test(h)) throw new Error(h)
    })
    await page.getByRole('tab', { name: '60', exact: true }).click()
    await page.waitForTimeout(800)
    await check('rotation lookback 60 updates eyebrow', async () => {
      const t = await page.locator('text=/ABSOLUTE VS RELATIVE/i').first().innerText()
      if (!/60 SESSIONS/i.test(t)) throw new Error(t)
    })
    await page.getByRole('tab', { name: 'Volatility', exact: true }).click()
    await page.waitForTimeout(500)
    await check('rotation bubble metric volatility selected', async () => {
      const s = await page.getByRole('tab', { name: 'Volatility', exact: true }).getAttribute('aria-selected')
      if (s !== 'true') throw new Error('not selected')
    })
    await page.getByRole('button', { name: /13\/13 sectors/ }).click()
    await page.waitForTimeout(300)
    await check('rotation sector filter opens', async () => {
      if (!(await page.getByRole('button', { name: 'Show all', exact: true }).isVisible())) throw new Error('filter not visible')
    })
    const bank = page.getByRole('button', { name: 'Commercial Banks', exact: true }).first()
    await bank.click()
    await page.waitForTimeout(600)
    await check('rotation filter hides a sector', async () => {
      const t = await page.getByRole('button', { name: /12\/13 sectors/ }).innerText()
      if (!/12\/13/.test(t)) throw new Error(t)
      const shown = await page.locator('text=/12 of 13 shown/').first().innerText()
      if (!/12 of 13/.test(shown)) throw new Error(shown)
    })
    await page.getByRole('button', { name: 'Show all', exact: true }).click()
    await page.waitForTimeout(400)
    await check('rotation show all restores 13', async () => {
      const t = await page.getByRole('button', { name: /13\/13 sectors/ }).innerText()
      if (!/13\/13/.test(t)) throw new Error(t)
    })
    await page.getByRole('tab', { name: 'Excess', exact: true }).click()
    await page.waitForTimeout(700)
    await check('rotation timeline excess mode', async () => {
      const t = await page.locator('text=Excess return, every sector').first().innerText()
      if (!t) throw new Error('title missing')
    })
    await page.getByRole('button', { name: 'Thresholds', exact: true }).click()
    await page.waitForTimeout(300)
    await check('rotation thresholds panel opens', async () => {
      const n = await page.locator('input[type=range]').count()
      if (n < 2) throw new Error(`range inputs ${n}`)
    })
    await page.getByRole('button', { name: 'Thresholds', exact: true }).click()
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.waitForTimeout(500)
    await check('rotation reset restores lookback 20 + rank', async () => {
      const t = await page.locator('text=/ABSOLUTE VS RELATIVE/i').first().innerText()
      if (!/20 SESSIONS/i.test(t)) throw new Error(t)
      const rank = await page.getByRole('tab', { name: 'Rank', exact: true }).getAttribute('aria-selected')
      if (rank !== 'true') throw new Error('rank not restored')
    })
    await check('rotation CSV download', async () => {
      const d = await downloadOf(page, page.getByRole('button', { name: 'CSV', exact: true }).first())
      console.log('  csv', d.name, d.size)
      if (!/\.csv$/.test(d.name)) throw new Error(d.name)
    })
    await check('rotation PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('rotation no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Breadth ----------
  {
    const { browser, page, errors } = await newPage('/breadth')
    await page.getByRole('tab', { name: '260', exact: true }).click()
    await page.waitForTimeout(900)
    await check('breadth 260 window badge', async () => {
      const t = await page.locator('text=/260 index sessions/').first().innerText()
      if (!/260 INDEX SESSIONS/i.test(t)) throw new Error(t)
    })
    await page.getByRole('tab', { name: '60', exact: true }).click()
    await page.waitForTimeout(900)
    await check('breadth 60 window badge', async () => {
      const t = await page.locator('text=/60 index sessions/').first().innerText()
      if (!/60 INDEX SESSIONS/i.test(t)) throw new Error(t)
    })
    await check('breadth PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('breadth no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Risk ----------
  {
    const { browser, page, errors } = await newPage('/risk')
    const sel = page.locator('select[aria-label="Drawdown sector"]')
    const before = await page.locator('text=/Drawdown from peak/i').first().count().catch(() => 0)
    await sel.selectOption({ label: 'Commercial Banks' })
    await page.waitForTimeout(900)
    await check('risk sector selection changes', async () => {
      const v = await sel.inputValue()
      if (v !== 'BANKING') throw new Error(v)
    })
    await check('risk CSV download', async () => {
      const d = await downloadOf(page, page.getByRole('button', { name: 'CSV', exact: true }).first())
      console.log('  csv', d.name, d.size)
      if (!/\.csv$/.test(d.name)) throw new Error(d.name)
    })
    await check('risk PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('risk no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Fundamentals ----------
  {
    const { browser, page, errors } = await newPage('/fundamentals')
    await page.locator('h1').waitFor()
    const next = page.getByRole('button', { name: /Next sector/ })
    const before = await page.locator('main').innerText()
    await next.click()
    await page.waitForTimeout(900)
    await check('fundamentals next sector changes panel', async () => {
      const after = await page.locator('main').innerText()
      if (after === before) throw new Error('content unchanged')
    })
    await check('fundamentals CSV download', async () => {
      const d = await downloadOf(page, page.getByRole('button', { name: 'CSV', exact: true }).first())
      console.log('  csv', d.name, d.size)
      if (!/\.csv$/.test(d.name)) throw new Error(d.name)
    })
    await check('fundamentals PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('fundamentals no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Sector Explorer ----------
  {
    const { browser, page, errors } = await newPage('/sectors')
    await page.getByRole('button', { name: 'Finance', exact: true }).first().click()
    await check('sector explorer switches sector', async () => {
      await page.getByText('Participation inside Finance').waitFor({ timeout: 12000 })
      const txt = await page.locator('main').innerText()
      if (!/Finance/.test(txt)) throw new Error('Finance not shown')
    })
    await page.getByRole('tab', { name: '1Y', exact: true }).click()
    await page.waitForTimeout(700)
    await check('sector explorer range 1Y selected', async () => {
      const s = await page.getByRole('tab', { name: '1Y', exact: true }).getAttribute('aria-selected')
      if (s !== 'true') throw new Error('1Y not selected')
    })
    await check('sector explorer PNG download', async () => {
      const d = await downloadOf(page, page.locator('button[aria-label^="Export"]').first())
      console.log('  png', d.name, d.size)
      if (!/\.png$/.test(d.name)) throw new Error(d.name)
    })
    await check('sector explorer no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Research sliders ----------
  {
    const { browser, page, errors } = await newPage('/research')
    const s = page.locator('input[type=range]').first()
    const before = await page.locator('main').innerText()
    await s.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
    await check('research slider changes score state', async () => {
      const after = await page.locator('main').innerText()
      if (after === before) throw new Error('no change')
    })
    await page.getByRole('button', { name: 'Reset weights', exact: true }).click().catch(async () => {
      await page.getByRole('button', { name: /Reset/ }).first().click()
    })
    await page.waitForTimeout(500)
    await check('research reset weights works', async () => {
      const v = await page.locator('input[type=range]').first().inputValue()
      if (v !== '25') throw new Error(`first slider ${v}`)
    })
    await check('research no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Data quality / events / methodology / 404 ----------
  for (const [route, name] of [['/data-quality', 'data quality'], ['/events', 'events'], ['/methodology', 'methodology'], ['/nope', '404']]) {
    const { browser, page, errors } = await newPage(route)
    await check(`${name} renders`, async () => {
      const h = await page.locator('h1').count()
      if (!h) throw new Error('no h1')
    })
    await check(`${name} no console errors`, async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Command palette + theme ----------
  {
    const { browser, page, errors } = await newPage('/')
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(400)
    await check('command palette opens', async () => {
      if (!(await page.getByRole('dialog', { name: 'Command palette' }).isVisible())) throw new Error('not visible')
    })
    await page.getByPlaceholder('Jump to a page or sector…').fill('rotation')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(900)
    await check('command palette navigates', async () => {
      if (!/\/rotation$/.test(page.url())) throw new Error(page.url())
    })
    const tog = page.getByRole('button', { name: /Switch to (dark|light) theme/ }).first()
    await tog.click()
    await page.waitForTimeout(400)
    await check('theme toggle switches theme', async () => {
      const cls = await page.locator('html').getAttribute('class')
      if (!/dark/.test(cls || '')) throw new Error(`html class=${cls}`)
    })
    await check('layout no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  // ---------- Mobile drawer ----------
  {
    const browser = await firefox.launch()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.waitForTimeout(400)
    await check('mobile drawer opens', async () => {
      if (!(await page.getByRole('button', { name: 'Close menu' }).isVisible())) throw new Error('no close button')
    })
    await page.getByRole('link', { name: 'Rotation Lab', exact: true }).first().click()
    await page.waitForTimeout(900)
    await check('mobile drawer navigates', async () => {
      if (!/\/rotation$/.test(page.url())) throw new Error(page.url())
    })
    await check('mobile no console errors', async () => { if (errors.length) throw new Error(errors.join(' | ')) })
    await browser.close()
  }

  console.log('\nSUMMARY', { pass, fail })
  if (fail) { console.log(failures.join('\n')); process.exit(1) }
})().catch((e) => { console.error(e); process.exit(1) })
