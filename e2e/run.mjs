/*
  End-to-end journey test in a real browser. Serves the production build through
  the Node API, then drives headless Edge or Chrome with Playwright.
  Usage: npm run build && npm run test:e2e
  Set E2E_BROWSER to a browser path, and E2E_SHOTS to a folder for screenshots.
*/
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.E2E_SHOTS
const BROWSERS = [
  process.env.E2E_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const results = []
let page
let browserErrors = []

async function step(name, fn) {
  if (process.env.E2E_ONLY === 'accessibility' && !/Welcome page|Choose Maple Trail|Text size persists|Read aloud uses|Offline Help|Integration category sections/.test(name)) return
  const before = browserErrors.length
  try {
    await fn()
    const fresh = browserErrors.slice(before)
    if (fresh.length) throw new Error(`Console errors: ${fresh.join(' | ').slice(0, 400)}`)
    results.push({ name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `fail-${results.length}.png`) }).catch(() => {})
  }
}

const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}
const see = (text, options) => page.getByText(text, options).first().waitFor({ timeout: 8000 })
const HEADINGS = { Overview: 'Waymark Command Center', 'Canadian Alternatives': 'Find Canadian Alternatives', 'Global Alternatives': 'Explore Global Alternatives' }
const nav = async (label) => {
  await page.getByRole('navigation', { name: 'Application' }).getByRole('link', { name: label }).click()
  await page.getByRole('heading', { level: 1, name: HEADINGS[label] ?? label }).waitFor()
}
const button = (name, options) => page.getByRole('button', { name, ...options })
// Settings is reached only from the gear in the top bar, not from the feature menu.
const openSettings = async () => {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Company Settings' }).waitFor()
  assert((await page.getByRole('navigation', { name: 'Application' }).count()) === 0, 'The settings screen should not show the feature menu')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  assert(existsSync('dist/index.html'), 'dist/ is missing. Run npm run build first.')
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const server = createApp({ ...loadConfig({}), dataDir: '', rateLimitPerMinute: 5000 }).listen(PORT, '127.0.0.1')

  const executablePath = BROWSERS.find((b) => existsSync(b))
  assert(executablePath, 'No Chromium-based browser found. Set E2E_BROWSER.')
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  page = await context.newPage()
  // Browser tests use a labeled deterministic fixture rather than requiring the public FX service.
  await page.route('**/api/fx', route => route.fulfill({ json: { rates: { CAD: 1, USD: 1.36, EUR: 1.48, CNY: 0.19, VND: 0.000053 }, source: 'E2E fixture (not live Bank of Canada)', asOf: '2026-11-16', live: true } }))
  page.on('console', (m) => {
    // GDELT's rate-limit replies carry no CORS header, so the browser logs them. The news panel falls back to RSS.
    if (m.type() === 'error' && !/Failed to load resource|api\.gdeltproject\.org/.test(m.text())) browserErrors.push(m.text())
  })
  page.on('pageerror', (e) => browserErrors.push(e.message))

  await step('Welcome page opens, with Try Demo', async () => {
    await page.goto(BASE)
    await see('Plan.')
    await shot('01-landing')
    await button('Try Demo').first().click()
    await page.waitForURL('**/demo')
  })

  await step('Choose Maple Trail and the Pro demo tier', async () => {
    await button('Pro').click()
    await button('Open Maple Trail Home Goods').click()
    await page.waitForURL('**/app')
    await see('Waymark Command Center')
    await see('Demo Data: fictional company')
  })

  await step('Dashboard shows company metrics, with no map preview', async () => {
    await see('Total suppliers')
    await see('Current risk feed')
    assert((await page.getByText('so this spend is excluded from CAD totals').count()) === 0, 'A supported currency was reported as unconverted')
    assert((await page.getByText('Live exchange rates are unavailable').count()) === 0, 'Live FX should have loaded')
    assert((await page.locator('canvas.maplibregl-canvas').count()) === 0, 'The dashboard should not load the map')
    assert((await page.getByText('Live picture').count()) === 0, 'The Live picture section should be gone')
    await shot('02-dashboard')
  })

  await step('Inspect an import route and its shipment details on the map page', async () => {
    await nav('Supply Chain Map')
    await page.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 })
    // A shipment marker must lie between its route's ends, not be flung elsewhere by CSS.
    const canvas = await page.locator('canvas.maplibregl-canvas').boundingBox()
    // "Ready" is not enough: the canvas must have real size and markers must sit inside it.
    assert(canvas && canvas.height > 200 && canvas.width > 300, `Map canvas is ${canvas?.width}x${canvas?.height}`)
    const marker = await page.locator('[data-node-id="sup-mt-s-1"]').first().boundingBox()
    assert(marker && marker.x > canvas.x && marker.x < canvas.x + canvas.width && marker.y > canvas.y && marker.y < canvas.y + canvas.height, 'Supplier marker is outside the map')
    for (const box of await Promise.all((await page.locator('.wm-vehicle').all()).map((v) => v.boundingBox()))) {
      assert(box.x >= canvas.x - 20 && box.x <= canvas.x + canvas.width + 20, 'A shipment marker is outside the map')
    }
    await page.locator('[data-node-id="sup-mt-s-1"]').click()
    await page.getByRole('heading', { name: 'Saigon Riverline Metalworks' }).waitFor()
    await button('Clear').click()
    await page.locator('.wm-vehicle').first().click()
    await see('Estimated emissions')
    await see('Potential disruptions')
    await shot('03-map')
  })

  await step('Shipment table shows transport emissions', async () => {
    await nav('Shipments')
    await see('MT-2041')
    await page.getByRole('row', { name: /MT-2041/ }).click()
    await see('Waymark estimate, not Climatiq')
    await page.keyboard.press('Escape')
  })

  await step('Run a disruption scenario with live inputs', async () => {
    await nav('Risk Simulator')
    await see('Total added cost')
    const total = () => page.locator('text=Total added cost').locator('..').locator('..').innerText()
    const before = await total()
    await page.getByRole('tab', { name: 'Tariff increase' }).click()
    await page.getByRole('tab', { name: 'Port congestion or closure' }).click()
    await page.getByRole('tab', { name: 'Trade restrictions' }).click()
    await page.getByRole('tab', { name: 'Supplier delay' }).click()
    const slider = page.getByRole('slider', { name: 'Delay' })
    await slider.fill('90')
    await page.waitForTimeout(200)
    assert((await total()) !== before, 'Total did not change when the delay changed')
    await page.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 })
  })

  await step('Compare financial and environmental consequences of actions', async () => {
    await see('Compare responses')
    await see('Build safety stock')
    await see('Alternative supplier')
    await page.getByLabel('Scenario name').fill('E2E delay test')
    await button('Save scenario').click()
    await see('E2E delay test')
    await page.waitForTimeout(500)
    await shot('04-simulator')
  })

  await step('Explore Canadian alternatives, with Request Quote for unknown prices', async () => {
    await nav('Canadian Alternatives')
    await see('Northfield Cookware Works')
    await see('Request Quote')
    await page.locator('[data-testid="compare-table"]').waitFor()
    await shot('05-canadian')
  })

  await step('Compare cost, quality, delivery, emissions and documentation', async () => {
    const table = await page.locator('[data-testid="compare-table"]').innerText()
    for (const label of ['Landed cost', 'Quality fit', 'Delivery time', 'Transport CO₂e', 'Labour documentation', 'Change from current']) {
      assert(table.includes(label), `Comparison is missing ${label}`)
    }
  })

  await step('Review a data-grounded recommendation that responds to priorities', async () => {
    const box = page.locator('[data-testid="recommendation"]')
    await box.waitFor()
    const first = await box.innerText()
    await page.getByLabel('What matters most?').selectOption('cost')
    await page.waitForTimeout(150)
    assert((await box.innerText()) !== first, 'Recommendation did not change with priority')
    await page.getByLabel('What matters most?').selectOption('balanced')
  })

  await step('Explore global alternatives with labelled hypothetical comparisons', async () => {
    await nav('Global Alternatives')
    await see('Your assumptions')
    await see('Hypothetical market comparison')
    await page.getByLabel('Price vs current (%)').first().fill('4')
    await page.getByLabel('Duty rate (%)').first().fill('0')
    await page.waitForTimeout(200)
    await button(/Test .* in Risk Simulator/).first().click()
    await page.waitForURL('**/simulator')
    await see('Compare responses')
  })

  await step('Sustainability figures match the dashboard total', async () => {
    await nav('Sustainability')
    const label = page.getByText('Total estimated shipment transport CO₂e')
    const value = await label.locator('..').locator('..').locator('p').nth(1).innerText()
    await see('Emissions by freight mode')
    await see('Responsible-sourcing documentation')
    await page.waitForTimeout(400)
    await shot('06-sustainability')
    await nav('Overview')
    const dash = await page.getByText('Estimated transport emissions').locator('..').locator('..').locator('p').nth(1).innerText()
    assert(value === dash, `Mismatch: sustainability ${value}, dashboard ${dash}`)
  })

  await step('Generate a report and export a real PDF and CSV', async () => {
    await nav('Reports')
    await button('Generate').nth(3).click()
    await page.locator('[data-testid="report-view"]').waitFor()
    await see('Summary for decision-makers')
    await shot('07-report')
    const [pdf] = await Promise.all([page.waitForEvent('download'), button('Export PDF').click()])
    const pdfPath = await pdf.path()
    assert(readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF', 'Download is not a PDF')
    assert(readFileSync(pdfPath).length > 5000, 'PDF is suspiciously small')
    if (SHOTS) await pdf.saveAs(path.join(SHOTS, 'report.pdf'))
    const [csv] = await Promise.all([page.waitForEvent('download'), button('Export CSV').click()])
    assert(readFileSync(await csv.path(), 'utf8').includes('Maple Trail'), 'CSV is missing the company')
    await button('Save report').click()
    await see('No saved reports yet', { exact: false }).then(() => { throw new Error('Report did not save') }, () => {})
  })

  await step('Switch to Free: restrictions apply and data is preserved', async () => {
    await button('Free', { exact: true }).click()
    await nav('Overview')
    await see('adding more is paused')
    await nav('Shipments')
    assert(await button('Add shipment').isDisabled(), 'Add shipment should be disabled on Free')
    await see('Live aircraft near your airports')
    await page.locator('[data-locked="tracking.live"]').waitFor()
    assert((await page.getByRole('row').count()) > 6, 'Shipments should survive the downgrade')
    await nav('Risk Simulator')
    await page.getByRole('tab', { name: 'Severe weather' }).click()
    await page.locator('[data-locked="scenario.advanced"]').waitFor()
    await page.getByRole('tab', { name: 'Tariff increase' }).click()
    await page.locator('[data-locked="scenario.compare"]').waitFor()
    await nav('Canadian Alternatives')
    await page.locator('[data-locked="alternatives.canadian.full"]').waitFor()
    await nav('Sustainability')
    await page.locator('[data-locked="sustainability.advanced"]').first().waitFor()
    await nav('Reports')
    assert(await button('Generate').count() === 1, 'Free should offer one report type')
    await nav('Supply Chain Map')
    await page.locator('[data-locked="map.advanced"]').waitFor()
    await shot('08-free')
  })

  await step('The server refuses Pro features to the Free preview', async () => {
    const status = await page.evaluate(async () => (await fetch('/api/aircraft?lat=43&lon=-79', { headers: { 'X-Waymark-Preview-Plan': 'free' } })).status)
    assert(status === 403, `Expected 403, got ${status}`)
  })

  await step('Switch to Enterprise: the advanced experience unlocks', async () => {
    await button('Enterprise', { exact: true }).click()
    await nav('Reports')
    await see('Custom report builder')
    await button('Build custom report').click()
    await page.locator('[data-testid="report-view"]').waitFor()
    await openSettings()
    await page.getByRole('tab', { name: 'Admin' }).click()
    await see('Administrative dashboard')
    await see('Multi-location analysis')
    await see('Configurable integration point', { exact: false })
    await page.getByRole('tab', { name: 'Team' }).click()
    await see('Demo Auditor')
    await page.getByRole('tab', { name: 'Admin' }).click()
    await shot('09-enterprise')
  })

  await step('Northern Leaf Apparel opens with country-level supplier handling', async () => {
    await button('Exit demo').click()
    await page.waitForURL(BASE + '/')
    await page.goto(`${BASE}/demo`)
    await button('Open Northern Leaf Apparel').click()
    await see('Waymark Command Center')
    await nav('Supply Chain Map')
    await page.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 })
    await page.locator('[data-node-id="sup-nl-s-5"]').click()
    await see('Country-level location')
    await button('Exit demo').click()
  })

  await step('Sign up creates a clearly labelled local workspace, with no password field', async () => {
    await page.goto(`${BASE}/signup`)
    await see('local workspace', { exact: false })
    assert((await page.locator('input[type=password]').count()) === 0, 'Local mode must not collect a password')
    await page.getByLabel('Company name').fill('Test Trading Inc')
    await button('Create local workspace').click()
    await page.waitForURL('**/onboarding')
  })

  await step('Onboarding: company, products with HS suggestions', async () => {
    await page.getByLabel('Industry').selectOption('apparel')
    await page.getByLabel('Headquarters city').fill('Toronto')
    await page.getByLabel('Province', { exact: true }).selectOption('ON')
    await button('Next').click()
    await page.getByLabel('Product name').fill('Cotton T-shirts')
    await see('6109.10')
    await see('not a legal classification', { exact: false })
    await page.getByRole('button', { name: /6109\.10/ }).click()
    await see('6-digit international HS')
    await page.getByLabel('Annual quantity').fill('1000')
    await page.getByLabel('Unit weight (kg)').fill('0.2')
    await button('Add another product').click()
    assert((await page.locator('[data-testid="product-form"]').count()) === 2, 'Second product form missing')
    await button('Remove').last().click()
    await page.reload()
    await see('Step 2 of 6')
    assert((await page.getByLabel('Product name').first().inputValue()) === 'Cotton T-shirts', 'Progress was not kept across reload')
    await button('Next').click()
  })

  await step('Onboarding: dynamic supplier forms with exact financial inputs', async () => {
    await page.getByLabel('How many suppliers').fill('3')
    assert((await page.locator('[data-testid="supplier-form"]').count()) === 3, 'Expected three supplier forms')
    await page.getByLabel('How many suppliers').fill('9')
    await see('saves up to 3 suppliers', { exact: false })
    await page.getByLabel('How many suppliers').fill('2')
    assert((await page.locator('[data-testid="supplier-form"]').count()) === 2, 'Expected two supplier forms')
    await button('Next').click()
    await see('Each supplier needs a name and a country')
    const names = page.getByLabel('Supplier name')
    const countries = page.getByLabel('Country', { exact: true })
    await names.nth(0).fill('Test Mill One')
    await countries.nth(0).selectOption('BD')
    await page.getByLabel('Annual spending').nth(0).fill('120000.50')
    await page.getByLabel('Currency').nth(0).selectOption('USD')
    await names.nth(1).fill('Test Mill Two')
    await countries.nth(1).selectOption('VN')
    await page.getByLabel('City or region').nth(1).fill('Da Nang')
    await page.getByLabel('Annual spending').nth(1).fill('80000')
    await button('Next').click()
    await button('Next').click()
    await see('Enter annual import spending')
    await page.getByLabel('Annual import spending').fill('250000.75')
    await page.getByLabel('Annual freight spending').fill('18000.25')
    await see('$250,001')
    await button('Next').click()
    await page.getByLabel('Inventory coverage (days of stock)').fill('20')
    await button('Next').click()
    await see('Test Mill One, Test Mill Two')
    await button('Open my dashboard').click()
    await page.waitForURL('**/app', { timeout: 20000 })
  })

  await step('New company dashboard uses exact inputs and honest locations', async () => {
    await see('Local workspace: this browser only')
    await see('Actual input')
    await see('$250')
    await nav('Supply Chain Map')
    await page.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 })
    assert((await page.locator('[data-node-id^="sup-"]').count()) === 2, 'Both suppliers should be on the map')
    await page.locator('.wm-node--approx').first().waitFor()
  })

  await step('Add, edit and delete a shipment, with metrics following', async () => {
    await nav('Shipments')
    await button('Add your first shipment').click()
    await button('Save shipment').click()
    await see('Enter a reference')
    await page.getByLabel('Reference').fill('TEST-1')
    await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Test Mill One' })
    await page.getByLabel('Shipment weight (kg)').fill('5000')
    await page.getByLabel('Shipping cost').fill('2500')
    await button('Save shipment').click()
    await page.getByRole('row', { name: /TEST-1/ }).waitFor()
    await see('Manual entry')
    await button('Edit TEST-1').click()
    await page.getByRole('dialog').getByLabel('Status').selectOption('delayed')
    await button('Save shipment').click()
    await page.getByRole('row', { name: /Delayed/ }).waitFor()
    await nav('Overview')
    const delayed = await page.getByText('Delayed shipments').locator('..').locator('..').locator('p').nth(1).innerText()
    assert(delayed === '1', `Delayed metric should be 1, got ${delayed}`)
    await nav('Shipments')
    await button('Delete TEST-1').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await see('No shipments yet')
  })

  await step('The workspace persists across a reload', async () => {
    await page.reload()
    await see('Test Trading Inc')
    await openSettings()
    await page.getByRole('tab', { name: 'Suppliers' }).click()
    await see('Test Mill One')
  })

  await step('Spawn creates a filled sample account for each tier, and each can be reopened', async () => {
    for (const [tier, company, suppliers] of [['Free', 'Harbour Lane Provisions', '3'], ['Pro', 'Cedar Ridge Outfitters', '5'], ['Enterprise', 'Trans-Canada Homeworks', '6']]) {
      await page.goto(`${BASE}/signup`)
      await button(`Spawn ${tier}`).click()
      assert((await page.getByLabel('Company name').inputValue()) === company, `${tier} did not fill the company name`)
      await button('Create local workspace').click()
      await page.waitForURL('**/onboarding')
      await see('Step 1 of 6')
      assert((await page.getByLabel('Headquarters city').inputValue()) !== '', 'Onboarding was not prefilled')
      for (let i = 0; i < 5; i++) await button('Next').click()
      await see('Review and finish')
      await button('Open my dashboard').click()
      await page.waitForURL('**/app', { timeout: 20000 })
      await see('Sample data: fictional company')
      await see(`${tier} plan`)
      const count = await page.getByText('Total suppliers').locator('..').locator('..').locator('p').nth(1).innerText()
      assert(count === suppliers, `${tier} should have ${suppliers} suppliers, got ${count}`)
      await nav('Supply Chain Map')
      await page.locator('[data-map-ready="true"]').first().waitFor({ timeout: 20000 })
      assert((await page.locator('[data-node-id^="sup-"]').count()) === Number(suppliers), `${tier} map should show every supplier`)
      await page.waitForTimeout(700)
      await shot(`12-spawn-${tier.toLowerCase()}`)
    }
    await button('Sign out').click()
    await page.goto(`${BASE}/signin`)
    await button(/Open Cedar Ridge Outfitters/).click()
    await see('Cedar Ridge Outfitters')
    await see('Pro plan')
  })

  await step('Company, Customer and Tariffs open from the site and return to it', async () => {
    for (const [name, route] of [['Company', '/company'], ['Customer', '/customer'], ['Tariffs', '/tariffs']]) {
      await page.goto(BASE)
      await page.locator('header').getByRole('button', { name, exact: true }).first().click()
      await page.waitForURL(`${BASE}${route}`)
      await page.getByRole('heading', { level: 1 }).waitFor()
      await button('Back to site').click()
      await page.waitForURL(`${BASE}/`)
    }
  })

  await step('The trial form opens, and its call to action reaches the working sign-up', async () => {
    await page.goto(`${BASE}/trial`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.goto(BASE)
    await page.locator('header').getByRole('button', { name: /sign ?up|sign ?in|log ?in/i }).first().click()
    await page.waitForURL(`${BASE}/signup`)
    await button('Spawn Pro').waitFor()
  })

  await step('Pricing page shows plans, comparison and no checkout', async () => {
    await page.goto(`${BASE}/pricing`)
    await see('Proposed pricing')
    await see('Try Interactive Demo')
    await see('Commercial signup is not available yet')
    assert(!(await page.content()).toLowerCase().includes('checkout now'), 'Unexpected checkout')
  })

  await step('The original quick estimate still works', async () => {
    await page.goto(`${BASE}/quick-estimate`)
    await button('See company profile').waitFor({ timeout: 2000 }).catch(() => {})
    await see('Step 1 of 3', { exact: false })
  })

  await step('Phone layout has no horizontal page scroll', async () => {
    await page.goto(`${BASE}/demo`)
    await button('Open Maple Trail Home Goods').click()
    await see('Waymark Command Center')
    await page.setViewportSize({ width: 400, height: 800 })
    for (const pathName of ['/app', '/app/shipments', '/app/simulator', '/app/sustainability', '/app/reports', '/app/settings']) {
      await page.goto(BASE + pathName)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      await page.waitForTimeout(250)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert(overflow <= 1, `${pathName} scrolls sideways by ${overflow}px`)
    }
    await shot('10-phone')
  })

  // Failure and fallback paths, each in a clean browser context.
  const fresh = async (init) => {
    await context.close().catch(() => {})
    const next = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    if (init) await next.addInitScript(init)
    page = await next.newPage()
    page.on('pageerror', (e) => browserErrors.push(e.message))
    return next
  }
  const openPro = async (base) => {
    await page.goto(`${base}/demo`)
    await button('Open Maple Trail Home Goods').click()
    await see('Waymark Command Center')
  }

  await step('With the API down, the app still works and says so', async () => {
    await fresh()
    await page.route('**/api/**', (route) => route.abort())
    await openPro(BASE)
    await see('API offline', { exact: false })
    await see('Live exchange rates are unavailable', { exact: false })
    await see('Weather data is unavailable', { exact: false })
    await nav('Sustainability')
    await see('Waymark estimate, not Climatiq')
    await nav('Canadian Alternatives')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await see('The directory is unavailable', { exact: false })
    await nav('Risk Simulator')
    await see('Total added cost')
  })

  await step('Without WebGL, the SVG map still shows the network', async () => {
    await fresh(() => {
      HTMLCanvasElement.prototype.getContext = () => null
    })
    await openPro(BASE)
    await nav('Supply Chain Map')
    await see('Simplified map: WebGL unavailable', { exact: false })
    await page.locator('svg path').first().waitFor()
    await shot('11-svg-fallback')
  })

  // A local stub following Climatiq's documented v3.1 response, to exercise the real UI path.
  let upstreamMode = 'ok'
  let upstreamCalls = 0
  const upstream = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      upstreamCalls += 1
      res.setHeader('Content-Type', 'application/json')
      if (upstreamMode === 'fail') {
        res.statusCode = 400
        return res.end(JSON.stringify({ error: 'bad_request', error_code: 'no_route_found', message: 'No route found' }))
      }
      const legs = JSON.parse(body).route.filter((r) => r.transport_mode)
      res.end(JSON.stringify({
        co2e: 1000 * legs.length,
        co2e_unit: 'kg',
        co2e_calculation_method: 'ipcc_ar6_gwp100',
        route: legs.flatMap((l) => [
          { type: 'location', name: 'stop', notices: [] },
          { type: 'leg', transport_mode: l.transport_mode, distance_km: 1000, co2e: 1000, notices: [] },
        ]).concat([{ type: 'location', name: 'end', notices: [] }]),
      }))
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const CLIMATIQ_PORT = PORT + 1
  const climatiq = createApp({
    ...loadConfig({}),
    rateLimitPerMinute: 5000,
    climatiqKey: 'stub-key',
    climatiqBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
  }).listen(CLIMATIQ_PORT, '127.0.0.1')
  const CLIMATIQ_BASE = `http://127.0.0.1:${CLIMATIQ_PORT}`

  await step('Failed Climatiq calls keep labelled estimates, never fake results', async () => {
    upstreamMode = 'fail'
    await fresh()
    await openPro(CLIMATIQ_BASE)
    await nav('Sustainability')
    await see('Climatiq failed', { exact: false })
    await see('Waymark estimate, not Climatiq')
    await see('0 from Climatiq')
  })

  await step('Working Climatiq results flow through every screen, labelled and consistent', async () => {
    upstreamMode = 'ok'
    upstreamCalls = 0
    await fresh()
    await openPro(CLIMATIQ_BASE)
    await nav('Sustainability')
    await see('8 from Climatiq', { exact: false })
    // Eight shipments, and the five sea-then-rail routes each need two calls.
    assert(upstreamCalls === 13, `Expected 13 upstream calls, got ${upstreamCalls}`)
    const value = await page.getByText('Total estimated shipment transport CO₂e').locator('..').locator('..').locator('p').nth(1).innerText()
    await see('Climatiq', { exact: true })
    await nav('Overview')
    const dash = await page.getByText('Estimated transport emissions').locator('..').locator('..').locator('p').nth(1).innerText()
    assert(value === dash, `Mismatch: sustainability ${value}, dashboard ${dash}`)
    await nav('Shipments')
    await page.getByRole('row', { name: /MT-2041/ }).click()
    await see('ipcc_ar6_gwp100', { exact: false })
    await page.keyboard.press('Escape')
    await page.reload()
    await see('MT-2041')
    assert(upstreamCalls === 13, 'Stored results should not be recalculated after a reload')
  })

  await step('Free tier uses the estimate even when Climatiq is configured', async () => {
    upstreamCalls = 0
    await fresh()
    await page.goto(`${CLIMATIQ_BASE}/demo`)
    await button('Free', { exact: true }).click()
    await button('Open Maple Trail Home Goods').click()
    await see('Waymark Command Center')
    await nav('Sustainability')
    await see('Waymark estimate, not Climatiq')
    assert(upstreamCalls === 0, 'Free must not reach Climatiq')
  })

  await step('Command Center: risk and activity feeds sit above the quick actions and scroll on their own', async () => {
    await fresh()
    await openPro(BASE)
    const top = async (text) => (await page.getByText(text, { exact: true }).first().boundingBox()).y
    const actions = await top('What would you like to do?')
    assert((await top('Current risk feed')) < actions && (await top('Activity feed')) < actions, 'Feeds should come before the quick actions')
    const tiles = page.getByRole('navigation', { name: 'Application' })
    assert((await tiles.getByRole('link', { name: 'Company Settings' }).count()) === 0, 'Settings should not be a quick action')
    await tiles.getByRole('link', { name: 'AI Trade Analyst' }).waitFor()
    await tiles.getByRole('link', { name: 'Global Risk Intelligence' }).waitFor()
    await page.getByRole('link', { name: 'Settings', exact: true }).waitFor()
    const feed = page.locator('#alerts .wm-scroll')
    assert((await feed.boundingBox()).height <= 300, 'Risk feed should be compact')
    assert(await feed.evaluate((el) => el.scrollHeight > el.clientHeight), 'Risk feed should scroll inside its card')
  })

  await step('Delay Assist without AI: read the email, compare options, approve, and see the decision on the shipment', async () => {
    await page.locator('#alerts').getByRole('link', { name: 'Resolve' }).click()
    await page.getByRole('heading', { level: 1, name: /Resolve delay · MT-2042/ }).waitFor()
    await button('Demo: Goods ready, vessel delayed').click()
    await see('pushed back about 30 days', { exact: false })
    await button('Confirm and continue').click()
    await see('There is no recommendation until this is filled in', { exact: false })
    assert(await button('Continue to message').isDisabled(), 'Approval should be blocked while stock is unknown')
    await page.getByRole('checkbox').check()
    await see('Gap: about 6 days without stock cover', { exact: false })
    await see('$28,200')
    await see('$24,000')
    await button('Continue to message').click()
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('956 units by air'))
    await button('Mark as sent and approve').click()
    await page.waitForURL('**/app/shipments')
    await page.getByRole('dialog').getByText('Approved: split the shipment', { exact: false }).first().waitFor()
    await page.keyboard.press('Escape')
    const row = page.getByRole('row', { name: /MT-2042/ })
    await row.getByText('Resolved').waitFor()
    assert((await row.getByText('Delayed').count()) === 1, 'Approving must not change the shipment status')
    await page.goto(`${BASE}/app/shipments/mt-sh-1/resolve`)
    await see('This shipment is not currently delayed', { exact: false })
  })

  await step('AI Trade Analyst without AI: several records, a rule-based answer, and context that survives a reload', async () => {
    await page.goto(`${BASE}/app/analyst`)
    await page.getByRole('heading', { level: 1, name: 'AI Trade Analyst' }).waitFor()
    await page.getByLabel('Shipment', { exact: true }).selectOption({ label: 'MT-2042 · Haiphong Blue Harbour Kitchenware' })
    await button('Add to context').click()
    await page.getByLabel('Add from your records').selectOption('country')
    await page.getByLabel('Country', { exact: true }).selectOption('CN')
    await button('Add to context').click()
    await button('How will this situation affect my business?').click()
    await see('Rule-based answer')
    await see('Your records involve', { exact: false })
    await see('Financial exposure')
    await page.reload()
    await see('Your records involve', { exact: false })
    await button('Remove China').click()
    assert((await page.getByText('2 of 12 items', { exact: false }).count()) === 0, 'Removed item should leave the context')
  })

  await step('World Situation: with the news sources down it says so and shows no headlines', async () => {
    await page.route('**/api/news**', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'news_unavailable', message: 'News sources are unavailable.' }) }))
    await page.route('**/api/google-news**', (route) => route.abort())
    await page.route('https://api.gdeltproject.org/**', (route) => route.abort())
    await page.goto(`${BASE}/app/world`)
    await see('Headlines could not be refreshed')
    assert((await page.getByRole('link', { name: 'Read at source' }).count()) === 0, 'No headline may be shown when the sources are down')
  })

  await step('World Situation: a headline is matched to company records and sent to the analyst', async () => {
    await page.unroute('**/api/news**')
    await page.route('**/api/news**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          category: 'shipping', source: 'Test feed', fetchedAt: new Date().toISOString(),
          articles: [
            { url: 'https://news.example/vancouver', title: 'Port of Vancouver congestion grows as rail backlog builds', publisher: 'Example Wire', publishedAt: new Date().toISOString(), category: 'shipping' },
            { url: 'https://news.example/brazil', title: 'Brazil coffee exporters face new customs checks', publisher: 'Other Daily', publishedAt: new Date().toISOString(), category: 'shipping' },
            { url: 'https://news.example/general', title: 'Freight rates steady as carriers add capacity', publisher: 'Other Daily', publishedAt: new Date().toISOString(), category: 'shipping' },
          ],
        }),
      }),
    )
    await page.reload()
    const card = page.locator('article', { hasText: 'Port of Vancouver congestion' })
    await card.getByText('Potential impact').waitFor()
    await card.getByText('Route uses Port of Vancouver', { exact: false }).first().waitFor()
    await page.locator('article', { hasText: 'Brazil coffee exporters' }).getByText('No identified exposure').waitFor()
    await page.locator('article', { hasText: 'Freight rates steady' }).getByText('Insufficient data').waitFor()
    assert((await card.getByRole('link', { name: 'Read at source' }).getAttribute('href')) === 'https://news.example/vancouver', 'The original link must be kept')
    await card.getByRole('button', { name: 'Analyze impact on my business' }).click()
    await page.waitForURL('**/app/analyst')
    await see('Port of Vancouver congestion grows as rail backlog builds')
    await see('Open article')
  })

  await step('Text size persists, Settings tabs deep link, and every app page fits at 150% on a phone', async () => {
    await page.goto(BASE + '/app/settings?tab=display')
    await page.getByRole('combobox', { name: 'Text size', exact: true }).last().selectOption('150')
    await page.reload()
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize === '24px'), 'Text size was not restored')
    await page.setViewportSize({ width: 360, height: 780 })
    for (const route of ['/app', '/app/map', '/app/shipments', '/app/simulator', '/app/canadian', '/app/global', '/app/sustainability', '/app/reports', '/app/analyst', '/app/world', '/app/settings?tab=profile', '/app/settings?tab=display', ...['products', 'suppliers', 'warehouses', 'financials', 'team', 'admin', 'plan'].map((tab) => `/app/settings?tab=${tab}`), '/app/shipments/mt-sh-2/resolve']) {
      await page.goto(BASE + route)
      await page.locator('main h1').waitFor()
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => ({ extra: document.documentElement.scrollWidth - innerWidth, elements: [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.overflow-x-auto')).slice(0, 5).map((el) => `${el.tagName}.${el.className}`) }))
      if (route === '/app') await shot('a11y-phone-150')
      assert(overflow.extra <= 1, `${route}: ${overflow.extra}px sideways overflow; ${overflow.elements.join(', ')}`)
    }
    await page.goto(BASE + '/app/shipments')
    await button('Add shipment', { exact: true }).click()
    const shipmentForm = page.getByRole('dialog', { name: 'Add shipment', exact: true })
    assert(await shipmentForm.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'Shipment form overflows at 150%')
    await page.keyboard.press('Escape')
    await page.getByRole('combobox', { name: 'Text size', exact: true }).first().selectOption('100')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BASE + '/app/settings?tab=profile')
    await page.getByRole('tab', { name: 'Profile', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.getElementById('tab-products')?.getAttribute('aria-selected') === 'true')
    assert(await page.getByRole('tab', { name: 'Products', exact: true }).getAttribute('aria-selected') === 'true', 'Settings tabs do not support arrow keys')
    await page.goto(BASE + '/app/shipments')
    await page.locator('main h1').waitFor()
    await page.waitForFunction(() => document.activeElement?.tagName === 'H1')
    await page.locator('tbody tr[tabindex="0"]').first().focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'Shipment details', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert(await page.getByRole('dialog', { name: 'Shipment details', exact: true }).count() === 0 || !(await page.getByRole('dialog', { name: 'Shipment details', exact: true }).isVisible()), 'Escape did not close shipment details')
  })

  await step('Read aloud uses meaningful page content, device voices, pause, resume, speed and stop', async () => {
    await page.addInitScript(() => {
      window.__speech = { spoken: [], paused: 0, resumed: 0, stopped: 0 }
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name: 'Device test voice', lang: 'en-CA', localService: true }],
        speak: (u) => { window.__activeUtterance = u; window.__speech.spoken.push({ text: u.text, rate: u.rate }) },
        pause: () => window.__speech.paused++, resume: () => window.__speech.resumed++, cancel: () => window.__speech.stopped++,
      } })
    })
    await page.goto(BASE + '/app')
    await page.locator('main h1').waitFor()
    await button('Read aloud', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Read aloud', exact: true })
    await dialog.getByRole('button', { name: 'Play', exact: true }).click()
    assert(await page.evaluate(() => window.__speech.spoken[0].text.includes('Command Center')), 'Speech did not begin with page content')
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click()
    await dialog.getByRole('button', { name: 'Play', exact: true }).click()
    assert(await page.evaluate(() => window.__speech.paused === 1 && window.__speech.resumed === 1), 'Pause/resume were not called')
    await dialog.getByRole('combobox', { name: 'Reading speed' }).selectOption('1.25')
    await dialog.getByRole('combobox', { name: 'Content to read' }).selectOption({ label: 'Current risk feed' })
    await dialog.getByRole('button', { name: 'Play', exact: true }).click()
    assert(await page.evaluate(() => window.__speech.spoken.at(-1).rate === 1.25 && window.__speech.spoken.at(-1).text.includes('Current risk feed')), 'Section selection or speed was ignored')
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await dialog.getByRole('status').getByText('Stopped', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert(!(await dialog.isVisible()), 'Escape did not close read aloud')
    await page.goto(BASE + '/app/shipments')
    await button('Read aloud', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Play', exact: true }).click()
    await page.evaluate(() => {
      for (let i = 0; i < 300; i++) {
        const utterance = window.__activeUtterance
        utterance?.onend?.()
        if (utterance === window.__activeUtterance) break
      }
    })
    assert(await page.evaluate(() => /Shipment: MT-204/.test(window.__speech.spoken.map((s) => s.text).join(' ')) && /Status:/.test(window.__speech.spoken.map((s) => s.text).join(' '))), 'Spoken table rows lost their column labels')
    await page.keyboard.press('Escape')
    const noSpeech = await page.context().newPage()
    await noSpeech.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); window.SpeechSynthesisUtterance = undefined })
    await noSpeech.goto(BASE + '/app/settings?tab=display')
    await noSpeech.getByText('Read aloud is unavailable because this browser does not support Web Speech.', { exact: false }).waitFor()
    assert(await noSpeech.getByRole('button', { name: 'Read aloud', exact: true }).count() === 0, 'Unsupported speech control should be hidden')
    await noSpeech.close()
  })

  await step('Offline Help matches questions, traps focus, tours across routes, and explains hidden targets', async () => {
    await page.goto(BASE + '/app')
    await button('Help', { exact: true }).click()
    const help = page.getByRole('dialog', { name: 'Help and guided tours', exact: true })
    await help.getByRole('textbox', { name: 'What would you like to do?' }).fill('how do I change my company name?')
    await help.getByRole('button', { name: 'Find a guide' }).click()
    const tour = page.getByRole('dialog', { name: 'Settings: profile', exact: true })
    await tour.waitFor()
    await page.waitForURL('**/app/settings?tab=profile')
    await page.locator('.wm-tour-spotlight').waitFor()
    await tour.getByRole('button', { name: 'End tour' }).focus()
    await page.keyboard.press('Tab')
    assert(await tour.getByRole('button', { name: 'Next', exact: true }).evaluate((el) => el === document.activeElement), 'Tour focus escaped')
    await tour.getByText('Step 1 of 3', { exact: true }).waitFor()
    await tour.getByRole('button', { name: 'Next', exact: true }).click()
    await tour.getByText('Step 2 of 3', { exact: true }).waitFor()
    await tour.getByRole('button', { name: 'Back', exact: true }).click()
    await tour.getByText('Step 1 of 3', { exact: true }).waitFor()
    await tour.getByRole('button', { name: 'Next', exact: true }).click()
    await tour.getByRole('button', { name: 'Next', exact: true }).click()
    await tour.getByText('Step 3 of 3', { exact: true }).waitFor()
    await tour.getByRole('button', { name: 'Finish', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await button('Help', { exact: true }).click()
    await help.getByRole('textbox').fill('pizza recipes')
    await help.getByRole('button', { name: 'Find a guide' }).click()
    await help.getByText('No matching guide found. Browse the topics below.').waitFor()
    await help.getByRole('button', { name: 'Change the dashboard vehicle', exact: true }).click()
    const vehicleTour = page.getByRole('dialog', { name: 'Change the dashboard vehicle', exact: true })
    await vehicleTour.getByRole('button', { name: 'Next', exact: true }).click()
    await page.waitForURL('**/app/settings?tab=display')
    await vehicleTour.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL('**/app')
    await page.keyboard.press('Escape')
    await page.goto(BASE + '/app/settings?tab=display')
    await page.getByRole('switch', { name: 'Hero scene', exact: false }).focus()
    await page.keyboard.press('Space')
    await button('Help', { exact: true }).click()
    await help.getByRole('textbox').fill('change dashboard scene vehicle')
    await help.getByRole('button', { name: 'Find a guide' }).click()
    await vehicleTour.getByText('This section is unavailable or hidden.', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    await page.goto(BASE + '/app/settings?tab=display')
    await page.getByRole('switch', { name: 'Hero scene', exact: false }).focus()
    await page.keyboard.press('Space')
  })

  await step('Integration category sections group providers and home has no intelligence cards', async () => {
    await page.goto(BASE + '/app')
    await see('Waymark Command Center')
    assert(await page.getByRole('heading', { name: 'Intelligence', exact: true }).count() === 0, 'Home intelligence card remains')
    assert(await page.getByRole('heading', { name: 'Weather intelligence', exact: true }).count() === 0, 'Home weather card remains')
    assert(await page.getByRole('link', { name: 'Integrations', exact: true }).count() === 0, 'Integrations should not be a dashboard feature')
    await openSettings()
    await page.getByRole('tab', { name: 'Integrations', exact: true }).click()
    await page.waitForURL('**/app/settings?tab=integrations')
    // AI models live under Settings → AI, not in the integrations list.
    await page.getByRole('region', { name: 'Accounting and Financial', exact: true }).getByRole('heading', { name: 'QuickBooks Online', exact: true }).waitFor()
    assert(await page.getByRole('heading', { name: 'Google Gemini', exact: true }).count() === 0, 'AI providers should not be listed under Integrations')
    await page.getByLabel('Search', { exact: true }).fill('Shopify')
    await page.getByRole('region', { name: 'CRM and Commerce', exact: true }).getByRole('heading', { name: 'Shopify', exact: true }).waitFor()
    assert(await page.getByRole('region', { name: 'Accounting and Financial', exact: true }).count() === 0, 'Sections with no match should be hidden by search')
    await page.getByLabel('Search', { exact: true }).fill('')
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await page.waitForURL('**/app/settings?tab=ai')
    const ai = page.getByRole('region', { name: 'AI models', exact: true })
    for (const name of ['Claude', 'OpenAI GPT', 'Google Gemini', 'Grok']) await ai.getByRole('heading', { name, exact: true }).waitFor()
    // Connecting asks for a key only, in a small dialog.
    await ai.getByRole('button', { name: 'Add key' }).nth(2).click()
    const keyDialog = page.getByRole('dialog', { name: 'Connect Google Gemini', exact: true })
    await keyDialog.getByLabel('API key').waitFor()
    assert(await keyDialog.getByLabel(/model/i).count() === 0, 'The key dialog should not ask for a model')
    await keyDialog.getByRole('button', { name: 'Cancel' }).click()
    // The light theme can be switched on and off from the top bar.
    await button('Switch to light theme').click()
    assert(await page.evaluate(() => document.documentElement.dataset.wmTheme) === 'light', 'Light theme was not applied')
    await button('Switch to dark theme').click()
    assert(await page.evaluate(() => document.documentElement.dataset.wmTheme) === 'dark', 'Dark theme was not restored')
    await page.getByRole('tab', { name: 'Integrations', exact: true }).click()
    await button('Help', { exact: true }).click()
    const help = page.getByRole('dialog', { name: 'Help and guided tours', exact: true })
    await help.getByRole('textbox').fill('')
    await help.getByRole('button', { name: 'Find a guide', exact: true }).click()
    await help.getByRole('button', { name: 'Settings: integrations', exact: true }).click()
    const guide = page.getByRole('dialog', { name: 'Settings: integrations', exact: true })
    await guide.getByText('Step 1 of 5', { exact: true }).waitFor()
    await guide.getByRole('button', { name: 'Next', exact: true }).click()
    await guide.getByText('Step 2 of 5', { exact: true }).waitFor()
    await page.locator('.wm-tour-spotlight').waitFor()
    await page.keyboard.press('Escape')
    await page.goto(BASE + '/app/integrations?error=state')
    await page.waitForURL(url => url.pathname === '/app/settings' && url.searchParams.get('tab') === 'integrations' && url.searchParams.get('error') === 'state')
    await page.getByText('The sign-in link expired or was already used', { exact: false }).waitFor()
    await page.setViewportSize({ width: 360, height: 780 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Integration sections overflow on mobile')
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  await step('New pages have no sideways scroll on a phone', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    for (const route of ['/app', '/app/analyst', '/app/world', '/app/shipments/mt-sh-2/resolve', '/demo']) {
      await page.goto(BASE + route)
      await page.waitForTimeout(600)
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert(extra <= 1, `${route} scrolls sideways by ${extra}px at 360px wide`)
    }
  })

  await step('Waymark 3: all six routes render and retain mobile layout', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BASE + '/demo')
    await button('Pro', {exact:true}).click()
    await button('Open Maple Trail Home Goods').click()
    await page.waitForURL('**/app')
    for (const [route,title] of [['agent','AI Agent Hub'],['activity','Agent Activity'],['approvals','Approvals'],['integrations','Company Settings'],['inventory','Inventory & Orders'],['finance','Financial Intelligence']]) {
      await page.goto(`${BASE}/app/${route}`)
      await page.getByRole('heading',{level:1,name:title,exact:true}).waitFor()
      await page.setViewportSize({width:360,height:780})
      await page.waitForTimeout(300)
      assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1), `${title} has mobile overflow`)
      await page.setViewportSize({width:1440,height:900})
    }
  })

  await step('Waymark 3: CSV import persists and appears in inventory', async () => {
    await page.goto(BASE + '/app/integrations')
    await button('Import with CSV import').click()
    const dialog=page.getByRole('dialog',{name:'Import business records'})
    await dialog.getByLabel('Record type').selectOption('products')
    await dialog.locator('input[type=file]').setInputFiles({name:'inventory.csv',mimeType:'text/csv',buffer:Buffer.from('name,sku,onHand,unitCost,currency\nE2E imported inventory,E2E-01,20,12,CAD')})
    await dialog.getByText('1 valid', {exact:false}).waitFor()
    await dialog.getByRole('button',{name:'Confirm and import valid records'}).click()
    await dialog.getByText('1 saved', {exact:false}).waitFor()
    await dialog.getByRole('button',{name:'Close',exact:true}).click()
    await page.goto(BASE + '/app/inventory')
    await see('E2E imported inventory / E2E-01')
    await page.reload();await see('E2E imported inventory / E2E-01')
  })

  await step('Waymark 3: guided planner demo produces evidence, saved history and an approval', async () => {
    await page.goto(BASE + '/app/agent')
    await button('Run guided demo',{exact:true}).click()
    await page.getByRole('heading',{name:'Investigation: completed',exact:true}).waitFor({timeout:30000})
    await see('get_weather_risk');await see('get_customer_orders')
    await button('Save report to Reports').click()
    await see('Report saved to Reports.')
    await page.reload();await page.getByRole('button',{name:/Check weather disruption, compare alternatives/}).first().click()
    await see('Investigation: completed')
    await page.goto(BASE + '/app/approvals')
    await button('Approve',{exact:true}).first().click()
    await see('not_sent',{exact:true})
    await page.goto(BASE + '/app/activity');await see('Monitoring configuration')
    await page.goto(BASE + '/app/settings?tab=ai')
    await page.getByLabel('Preferred provider').selectOption('')
    await button('Save AI preferences').click();await see('AI preferences saved.')
    await page.reload();assert(await page.getByLabel('Preferred provider').inputValue()==='', 'Planner preference did not persist')
    await page.goto(BASE + '/app');await see('Waymark Command Center')
  })

  climatiq.close()
  upstream.close()
  await browser.close()
  server.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} journeys passed.`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
