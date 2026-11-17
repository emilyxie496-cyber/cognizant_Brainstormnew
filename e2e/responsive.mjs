/*
  Responsive and RTL smoke test for the signed-in workspace.
  Opens the Maple Trail demo and visits every primary page at five widths, then in Arabic.
  Fails on page errors, a missing page heading, or horizontal page overflow.
  Usage: npm run build && node e2e/responsive.mjs   (E2E_SHOTS=dir to save screenshots)
*/
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'

const PORT = 8798
const BASE = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.E2E_SHOTS
const BROWSERS = [process.env.E2E_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)
const WIDTHS = [375, 430, 768, 1024, 1440]
const PAGES = ['/app', '/app/map', '/app/shipments', '/app/simulator', '/app/agent', '/app/activity', '/app/approvals', '/app/analyst', '/app/inventory', '/app/finance', '/app/integrations', '/app/reports', '/app/settings?tab=features', '/app/settings?tab=products', '/app/settings?tab=email', '/app/settings?tab=branding', '/app/settings?tab=language']

if (!existsSync('dist/index.html')) throw new Error('dist/ is missing. Run npm run build first.')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const server = createApp({ ...loadConfig({}), dataDir: '', rateLimitPerMinute: 10000 }).listen(PORT, '127.0.0.1')
const browser = await chromium.launch({ executablePath: BROWSERS.find((b) => existsSync(b)), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const failures = []
const errors = []
let checks = 0

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.route('**/api/fx', (r) => r.fulfill({ json: { rates: { CAD: 1, USD: 1.36, EUR: 1.48, CNY: 0.19 }, source: 'E2E fixture', asOf: '2026-11-16', live: true } }))
  await page.route('**/api/news**', (r) => r.fulfill({ json: { articles: [], source: 'E2E fixture' } }))
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))

  await page.goto(`${BASE}/demo`)
  await page.getByRole('button', { name: 'Pro' }).click()
  await page.getByRole('button', { name: 'Open Maple Trail Home Goods' }).click()
  await page.waitForURL('**/app')

  const visit = async (path, width, label) => {
    await page.setViewportSize({ width, height: width < 800 ? 820 : 900 })
    await page.goto(BASE + path)
    await page.locator('main h1').first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(250)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    checks++
    if (overflow > 1) failures.push(`${label} ${path} @${width}px overflows by ${overflow}px`)
    if (SHOTS && [375, 1440].includes(width)) await page.screenshot({ path: `${SHOTS}/${label}-${width}${path.replace(/[/?=&]+/g, '_')}.png` })
  }

  for (const width of WIDTHS) for (const path of PAGES) await visit(path, width, 'en')

  // Navigation: categories follow the URL, and the mobile drawer lists every category.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/app/finance`)
  const active = await page.locator('nav[aria-label="Feature categories"] [aria-current="true"]').innerText()
  if (!/Business/.test(active)) failures.push(`Deep link to /app/finance activated "${active}", expected Business`)
  await page.setViewportSize({ width: 375, height: 820 })
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  for (const name of ['Intelligence', 'Solutions', 'Business']) if (!(await page.getByRole('dialog').getByText(name, { exact: true }).count())) failures.push(`Mobile menu is missing ${name}`)
  await page.keyboard.press('Escape')

  // Arabic: right-to-left document, translated navigation, no overflow.
  await page.evaluate(() => { const k = 'waymark.viewPrefs.v1'; const p = JSON.parse(localStorage.getItem(k) ?? '{}'); localStorage.setItem(k, JSON.stringify({ ...p, language: 'ar' })) })
  for (const width of [375, 1440]) for (const path of ['/app', '/app/simulator', '/app/settings?tab=features', '/app/approvals']) await visit(path, width, 'ar')
  const dir = await page.evaluate(() => document.documentElement.dir)
  if (dir !== 'rtl') failures.push(`Arabic did not set dir=rtl (got ${dir})`)
  if (!(await page.getByText('الأعمال', { exact: true }).count())) failures.push('Arabic navigation text (Business category) is missing')
} finally {
  await browser.close()
  server.close()
}

console.log(`${checks} page/width checks run.`)
if (errors.length) console.log(`Page errors:\n  ${[...new Set(errors)].join('\n  ')}`)
if (failures.length) console.log(`Failures:\n  ${failures.join('\n  ')}`)
process.exit(errors.length || failures.length ? 1 : 0)
