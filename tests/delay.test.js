import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'
import { DELAY_DEMO_EMAILS } from '../src/data/delayDemoEmails.js'
import { DEMO_COMPANIES } from '../src/data/demoCompanies.js'
import { FX_SNAPSHOT } from '../src/data/fxSnapshot.js'
import { delayState, planDelayResponse } from '../src/engine/delayPlan.js'
import { draftFacts, managerDraft, supplierDraft } from '../src/engine/draftTemplates.js'
import { extractByRules, mergeExtractions } from '../src/engine/emailRules.js'
import { buildModel } from '../src/engine/model.js'
import { validateExtraction } from '../supabase/functions/_shared/agent.js'
import { numbersGrounded } from '../supabase/functions/_shared/grounding.js'
import { dedupeArticles, parseNewsRss } from '../supabase/functions/_shared/news.js'

const model = () => buildModel(DEMO_COMPANIES[0].build(), { fx: FX_SNAPSHOT })
const mt2042 = (m) => m.shipments.find((s) => s.reference === 'MT-2042')
const option = (plan, id) => plan.options.find((o) => o.id === id)

describe('Delay Assist: MT-2042 worked example', () => {
  it('goods ready, company default stock: a 6-day gap, and flying part is the cheapest way to close it', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 30, readiness: 'ready', useCompanyDefaultInventory: true, partialQty: null })
    expect(plan.branch).toBe('ready')
    expect(plan.coverage.days).toBe(24)
    expect(plan.coverage.provenance).toBe('assumption')
    expect(plan.uncoveredDays).toBe(6)
    expect(plan.recommendedId).toBe('expedite_partial')
    const part = option(plan, 'expedite_partial')
    expect(part.units).toBe(956)
    expect(part.costBasis).toBe('shipment')
    expect(part.extraCostCad).toBeGreaterThan(2080)
    expect(part.extraCostCad).toBeLessThan(2100)
    expect(part.uncoveredDays).toBe(0)
    expect(option(plan, 'expedite_full').extraCostCad).toBe(28_200)
    expect(option(plan, 'wait').extraCostCad).toBe(0)
    expect(option(plan, 'wait').uncoveredDays).toBe(6)
    expect(option(plan, 'wait').stockoutCostCad).toBe(24_000)
    expect(option(plan, 'expedite_full').co2eChangeKg).toBeGreaterThan(part.co2eChangeKg)
    expect(plan.approveBlockedReason).toBeNull()
    expect(plan.facts.find((f) => f.key === 'weeklyDemand')).toMatchObject({ value: 1115, provenance: 'derived' })
  })

  it('still in production: faster shipping is not offered and the advice is to get a ready date', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 21, readiness: 'in_production', useCompanyDefaultInventory: true })
    expect(plan.branch).toBe('in_production')
    expect(plan.recommendedId).toBe('chase_production')
    expect(option(plan, 'expedite_partial').feasible).toBe(false)
    expect(option(plan, 'alternative').feasible).toBe(false)
    expect(option(plan, 'alternative').feasibilityNote).toContain('too slow to help')
  })

  it('"not sure" is treated as in production and says so', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 21, readiness: 'unknown', useCompanyDefaultInventory: true })
    expect(plan.branch).toBe('in_production')
    expect(plan.assumptions.some((a) => a.text.includes('most cautious case'))).toBe(true)
  })

  it('in production with a released quantity: flying that quantity becomes available', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 40, readiness: 'in_production', partialQty: 500, useCompanyDefaultInventory: true })
    expect(option(plan, 'split_shipment')).toMatchObject({ feasible: true, units: 500 })
    expect(plan.recommendedId).toBe('chase_production')
  })

  it('stock unknown: no recommendation, a range, and approval is blocked', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 30, readiness: 'ready' })
    expect(plan.branch).toBe('inventory_unknown')
    expect(plan.recommendedId).toBeNull()
    expect(plan.uncoveredDays).toEqual([6, 30])
    expect(plan.approveBlockedReason).toContain('Enter inventory')
    expect(plan.nextQuestion).toBe('inventory')
    const wait = option(plan, 'wait')
    expect(wait.range.best.uncoveredDays).toBe(6)
    expect(wait.range.worst.uncoveredDays).toBe(30)
  })

  it('entered stock is used as an actual figure, and enough stock means wait', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 10, readiness: 'ready', onHandUnits: 5000, weeklyDemand: 1000 })
    expect(plan.coverage).toMatchObject({ days: 35, provenance: 'actual' })
    expect(plan.uncoveredDays).toBe(0)
    expect(plan.recommendedId).toBe('wait')
  })

  it('a supplier cap smaller than the gap leaves days uncovered, so flying everything closes it', () => {
    const m = model()
    const plan = planDelayResponse(mt2042(m), m, { delayDays: 30, readiness: 'ready', partialQty: 400, useCompanyDefaultInventory: true })
    expect(option(plan, 'expedite_partial').uncoveredDays).toBeGreaterThan(0)
    expect(plan.recommendedId).toBe('expedite_full')
  })

  it('missing freight cost: no shipment-level cost is invented', () => {
    const m = model()
    const s = { ...mt2042(m), costCad: null }
    const plan = planDelayResponse(s, m, { delayDays: 30, readiness: 'ready', useCompanyDefaultInventory: true })
    expect(option(plan, 'expedite_partial').costBasis).toBe('annual_estimate')
    expect(plan.missing).toContain('Freight cost for this shipment')
  })

  it('missing demand: weekly demand is reported missing and only a yearly estimate is offered', () => {
    const m = model()
    const s = { ...mt2042(m), product: { ...mt2042(m).product, annualQuantity: null } }
    const plan = planDelayResponse(s, m, { delayDays: 30, readiness: 'ready', useCompanyDefaultInventory: true })
    expect(plan.facts.find((f) => f.key === 'weeklyDemand').provenance).toBe('missing')
    expect(option(plan, 'expedite_partial').costBasis).toBe('annual_estimate')
  })

  it('asks one thing at a time, in order', () => {
    const m = model()
    expect(planDelayResponse(mt2042(m), m, {}).nextQuestion).toBe('delayDays')
    expect(planDelayResponse(mt2042(m), m, { delayDays: 30 }).nextQuestion).toBe('readiness')
    expect(planDelayResponse(mt2042(m), m, { delayDays: 30, readiness: 'ready' }).nextQuestion).toBe('inventory')
    expect(planDelayResponse(mt2042(m), m, { delayDays: 30, readiness: 'ready', useCompanyDefaultInventory: true }).nextQuestion).toBe('partialQty')
  })

  it('needs action until a person records a decision, and never changes the shipment status', () => {
    const m = model()
    const s = mt2042(m)
    expect(delayState(s, [])).toBe('needs_action')
    expect(delayState(s, [{ shipmentId: s.id, type: 'agent_suggestion', at: '2026-01-01' }])).toBe('needs_action')
    expect(delayState(s, [{ shipmentId: s.id, type: 'human_decision', at: '2026-01-02' }])).toBe('resolved')
    expect(delayState({ ...s, status: 'in_transit' }, [])).toBeNull()
  })
})

describe('Delay Assist: reading a supplier email without AI', () => {
  const quoted = (email, result) => Object.values(result.quotes).every((q) => email.includes(q))

  it('reads all three demo emails, and every quote is word for word', () => {
    const [ready, production, unclear] = DELAY_DEMO_EMAILS.map((e) => ({ email: e.text, result: extractByRules(e.text) }))
    expect(ready.result.fields).toMatchObject({ delayDays: 30, readiness: 'ready', partialQty: 6000, readyDate: null })
    expect(production.result.fields).toMatchObject({ delayDays: 21, readiness: 'in_production', partialQty: null })
    expect(unclear.result.fields).toMatchObject({ delayDays: 14, readiness: null })
    for (const x of [ready, production, unclear]) expect(quoted(x.email, x.result)).toBe(true)
    expect(ready.result.unsure).toEqual(['readyDate'])
  })

  it('reads a ready date and does not treat "not ready" as ready', () => {
    const r = extractByRules('The goods are not ready yet. They will be finished on Dec 5. Delay of 2 weeks.', Date.parse('2026-11-15'))
    expect(r.fields).toMatchObject({ readiness: 'in_production', readyDate: '2026-12-05', delayDays: 14 })
  })

  it('AI fields only fill what the patterns missed', () => {
    const rules = extractByRules(DELAY_DEMO_EMAILS[2].text)
    const merged = mergeExtractions(rules, { fields: { delayDays: 99, readiness: 'ready' }, quotes: { delayDays: 'x', readiness: 'We will update you soon' } })
    expect(merged.fields.delayDays).toBe(14)
    expect(merged.fields.readiness).toBe('ready')
    expect(merged.fieldBy.readiness).toBe('llm')
  })
})

describe('Delay Assist: AI output is never trusted', () => {
  const email = DELAY_DEMO_EMAILS[0].text

  it('drops a field whose quote is not in the email, or whose number is not in its quote', () => {
    const out = validateExtraction(email, {
      fields: { delayDays: 30, readiness: 'ready', partialQty: 9000, readyDate: '2026-12-01' },
      quotes: { delayDays: 'pushed back about 30 days', readiness: 'Goods are finished and paid for', partialQty: 'we can release 6,000 pcs', readyDate: 'ready on 1 December' },
    })
    expect(out.fields).toEqual({ delayDays: 30, readiness: null, readyDate: null, partialQty: null })
    expect(out.unsure).toEqual(['readiness', 'readyDate', 'partialQty'])
  })

  it('template drafts only contain figures from the plan', () => {
    const m = model()
    const s = mt2042(m)
    const plan = planDelayResponse(s, m, { delayDays: 30, readiness: 'ready', useCompanyDefaultInventory: true, partialQty: null })
    const facts = draftFacts(plan, option(plan, 'expedite_partial'), s, m.company)
    expect(numbersGrounded(supplierDraft(facts), facts)).toBe(true)
    expect(numbersGrounded(managerDraft(facts), facts)).toBe(true)
    expect(supplierDraft(facts)).toContain('956 units by air')
    expect(managerDraft(facts)).toContain('$2,0')
  })
})

describe('AI and news routes', () => {
  let server
  let llmMode = 'ok'
  let llmCalls = 0
  const SECRET = 'llm-secret-do-not-leak'
  const base = () => `http://127.0.0.1:${server.address().port}`
  const post = (path, body) => fetch(`${base()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const completion = (content) => new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  // Stand-in for the AI provider and the news source. No real network is used.
  const fetchImpl = async (url) => {
    const href = String(url)
    if (href.includes('/chat/completions')) {
      llmCalls += 1
      if (llmMode === 'quota') return new Response('{}', { status: 429 })
      if (llmMode === 'bad_quote') return completion(JSON.stringify({ fields: { delayDays: 30, readiness: 'ready' }, quotes: { delayDays: 'pushed back about 30 days', readiness: 'everything is ready and loaded' } }))
      if (llmMode === 'invented') return completion('We will pay 9999 dollars for air freight.')
      if (llmMode === 'not_json') return completion('Sorry, I cannot help with that.')
      return completion('The shipment is about 30 days late. We chose to fly 956 units.')
    }
    if (href.includes('/rss/search')) {
      if (llmMode === 'news_down') return new Response('', { status: 503 })
      return new Response(
        `<rss><channel>
          <item><title>Port of Vancouver congestion grows as rail backlog builds - Example Wire</title><link>https://news.example/a</link><pubDate>Sun, 15 Nov 2026 10:00:00 GMT</pubDate><source url="https://news.example">Example Wire</source></item>
          <item><title>Port of Vancouver congestion grows as rail backlog builds - Example Wire</title><link>https://news.example/b</link><pubDate>Sun, 15 Nov 2026 09:00:00 GMT</pubDate><source url="https://news.example">Example Wire</source></item>
          <item><title>Tariff talks resume &amp; markets react - Other Daily</title><link>https://other.example/c</link><pubDate>Sat, 14 Nov 2026 09:00:00 GMT</pubDate><source url="https://other.example">Other Daily</source></item>
        </channel></rss>`,
        { status: 200 },
      )
    }
    return new Response('{}', { status: 503 })
  }

  const start = (env) =>
    new Promise((resolve) => {
      const app = createApp({ ...loadConfig(env), rateLimitPerMinute: 5000, fetchImpl })
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })

  beforeAll(async () => {
    server = await start({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: SECRET, LLM_MODEL: 'test-model' })
  })
  afterAll(() => new Promise((resolve) => server.close(resolve)))

  it('health reports the assistant as a boolean and never leaks the key', async () => {
    const res = await fetch(`${base()}/api/health`)
    const text = await res.text()
    expect(JSON.parse(text).integrations.assistant).toBe(true)
    expect(text).not.toContain(SECRET)
  })

  it('extract: a quote that is not in the email empties that field', async () => {
    llmMode = 'bad_quote'
    const res = await post('/api/agent/delay', { mode: 'extract', text: DELAY_DEMO_EMAILS[0].text })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.fields.delayDays).toBe(30)
    expect(body.fields.readiness).toBeNull()
    expect(body.unsure).toContain('readiness')
  })

  it('extract: a reply that is not JSON counts as AI unavailable', async () => {
    llmMode = 'not_json'
    const res = await post('/api/agent/delay', { mode: 'extract', text: `${DELAY_DEMO_EMAILS[1].text} ` })
    expect(res.status).toBe(502)
  })

  it('draft: a figure that is not in the facts is rejected', async () => {
    llmMode = 'invented'
    const res = await post('/api/agent/delay', { mode: 'draft', audience: 'supplier', facts: { shipment: 'MT-2042', delayDays: 30, units: 956 } })
    expect(await res.json()).toEqual({ text: null, reason: 'unsupported_figure' })
  })

  it('draft: grounded text is returned, and an identical request is served from the cache', async () => {
    llmMode = 'ok'
    const facts = { shipment: 'MT-2042', delayDays: 30, chosen: { units: 956 } }
    const first = await (await post('/api/agent/delay', { mode: 'draft', audience: 'manager', facts })).json()
    const calls = llmCalls
    const second = await (await post('/api/agent/delay', { mode: 'draft', audience: 'manager', facts })).json()
    expect(first.text).toContain('956')
    expect(second).toEqual(first)
    expect(llmCalls).toBe(calls)
  })

  it('a provider quota error becomes 502 so the client can fall back', async () => {
    llmMode = 'quota'
    const res = await post('/api/agent/delay', { mode: 'draft', audience: 'supplier', facts: { shipment: 'X-1', delayDays: 12 } })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('ai_unavailable')
  })

  it('bad input is refused before any provider is called', async () => {
    const calls = llmCalls
    expect((await post('/api/agent/delay', { mode: 'extract', text: 'hi' })).status).toBe(400)
    expect((await post('/api/agent/delay', { mode: 'nope' })).status).toBe(400)
    expect((await post('/api/analyst', { question: 'x', findings: {} })).status).toBe(400)
    expect(llmCalls).toBe(calls)
  })

  it('analyst: an answer with an invented figure is rejected', async () => {
    llmMode = 'invented'
    const res = await post('/api/analyst', { question: 'How could this affect my business?', context: [{ type: 'shipment', title: 'MT-2042' }], findings: { shipments: 1 } })
    expect(await res.json()).toEqual({ text: null, reason: 'unsupported_figure' })
  })

  it('news: headlines are parsed, de-duplicated and keep their source link', async () => {
    llmMode = 'ok'
    const res = await fetch(`${base()}/api/news?category=shipping`)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.articles).toHaveLength(2)
    expect(body.articles[0]).toMatchObject({ title: 'Port of Vancouver congestion grows as rail backlog builds', publisher: 'Example Wire', url: 'https://news.example/a', category: 'shipping' })
    expect(body.articles[1].title).toBe('Tariff talks resume & markets react')
  })

  it('news: when the sources are down the route says so and returns no headlines', async () => {
    llmMode = 'news_down'
    const res = await fetch(`${base()}/api/news?category=policy`)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('news_unavailable')
  })

  it('with no provider configured the AI routes answer 503', async () => {
    const bare = await start({})
    try {
      const url = `http://127.0.0.1:${bare.address().port}`
      const res = await fetch(`${url}/api/agent/delay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'extract', text: DELAY_DEMO_EMAILS[0].text }) })
      expect(res.status).toBe(503)
      expect((await (await fetch(`${url}/api/health`)).json()).integrations.assistant).toBe(false)
    } finally {
      await new Promise((resolve) => bare.close(resolve))
    }
  })
})

describe('news helpers', () => {
  it('ignores rows without a usable link and repeats of the same headline', () => {
    const rows = dedupeArticles([
      { title: 'A real headline about freight rates', url: 'https://a.example/1', publishedAt: '2026-11-14T00:00:00Z' },
      { title: 'A real headline about freight rates!', url: 'https://b.example/2', publishedAt: '2026-11-15T00:00:00Z' },
      { title: 'No link here at all, sorry', url: 'javascript:alert(1)' },
    ])
    expect(rows).toHaveLength(1)
  })

  it('parses an empty feed to an empty list', () => {
    expect(parseNewsRss('<rss><channel></channel></rss>')).toEqual([])
  })
})
