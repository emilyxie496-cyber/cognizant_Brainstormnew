/*
  Waymark 3.0 API: integrations, business data, the agent, monitoring,
  approvals and notifications. Mounted by server/app.js.

  Tenancy. Every route here works on one tenant:
    - a signed-in company (from the verified Supabase session), or
    - an anonymous demo or local workspace, identified by the long random
      X-Waymark-Workspace key its browser generated. That key is the only thing
      that can reach the workspace's server-side state.

  The browser owns the company's records, so routes that need them (agent runs,
  monitoring, sample data) receive a workspace snapshot in the request and
  rebuild the same model the screens use. It is validated and never stored.
*/
import express from 'express'
import { INTEGRATIONS, LLM_PROVIDER_IDS, NOTIFICATION_CATEGORIES, integrationById } from '../shared/integrations.js'
import { can } from '../shared/entitlements.js'
import { buildModel } from '../src/engine/model.js'
import { NEWS_CATEGORIES, fetchWorldNews } from '../supabase/functions/_shared/news.js'
import { runAgent } from './agent/orchestrator.js'
import { TOOLS } from './agent/tools.js'
import { LLM_PROVIDERS } from './ai/providers.js'
import { ApprovalError, canDecide, createApprovals } from './approvals.js'
import { createVault, randomToken, vaultSecret } from './crypto.js'
import { UpstreamError, ttlCache } from './http.js'
import { verifyShopifyWebhook } from './integrations/adapters.js'
import { demoWeatherScenario } from './integrations/fixtures.js'
import { ConfigError, ProviderError, createIntegrationService } from './integrations/service.js'
import { DEFAULT_MONITOR, createMonitor } from './monitor.js'
import { CHANNELS, createNotifier } from './notify.js'
import { fetchWeather } from './providers.js'
import { createStore } from './store.js'

const WORKSPACE_KEY_RE = /^[A-Za-z0-9_-]{24,96}$/
const LIST_LIMITS = { warehouses: 200, products: 2000, suppliers: 1000, shipments: 5000, events: 5000, alternatives: 1000 }
const DEFAULT_SHARING = { financial: false, customers: false, inventory: false }

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** A checked copy of the workspace a browser sent. Unknown top-level keys are dropped. */
export function readWorkspace(body) {
  const ws = body?.workspace
  if (!ws || typeof ws !== 'object' || !ws.company || typeof ws.company !== 'object' || typeof ws.company.name !== 'string') {
    throw new HttpError(400, 'invalid_input', 'A workspace with a company is required.')
  }
  const out = { company: ws.company, scenarios: [], reports: [], comparisons: [], emissions: ws.emissions && typeof ws.emissions === 'object' && !Array.isArray(ws.emissions) ? ws.emissions : {} }
  for (const [key, max] of Object.entries(LIST_LIMITS)) {
    const list = ws[key] ?? []
    if (!Array.isArray(list) || list.length > max || list.some((r) => !r || typeof r !== 'object' || typeof r.id !== 'string')) throw new HttpError(400, 'invalid_input', `workspace.${key} must be a list of at most ${max} records with ids.`)
    out[key] = list
  }
  const rates = body.fx?.rates && typeof body.fx.rates === 'object' ? Object.fromEntries(Object.entries(body.fx.rates).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && Number.isFinite(Number(v)) && Number(v) > 0).map(([k, v]) => [k, Number(v)])) : {}
  const fx = { rates: { ...rates, CAD: 1 }, source: String(body.fx?.source ?? 'Supplied by the browser').slice(0, 80), asOf: String(body.fx?.asOf ?? '').slice(0, 20) || null }
  try {
    return { ws: out, fx, model: buildModel(out, { fx }) }
  } catch {
    throw new HttpError(400, 'invalid_input', 'The workspace could not be read. Reload the page and try again.')
  }
}

export function mountPlatform(app, config, { fetchImpl = fetch } = {}) {
  const store = createStore(config)
  const vault = createVault(vaultSecret(config))
  const integrations = createIntegrationService({ config, store, vault, fetchImpl })
  const notifier = createNotifier({ store, integrations })
  const approvals = createApprovals({ store, notifier, integrations })
  const weatherCache = ttlCache(30 * 60_000)
  const newsCache = ttlCache(15 * 60_000)
  const agentRate = new Map()
  const aiDaily = new Map()

  if (!vault.persistent && config.dataDir) console.warn('[waymark] No encryption key could be saved. Credentials are sealed with a temporary key and must be entered again after a restart.')

  /* ---------- Request helpers ---------- */

  const tenantOf = (req) => {
    if (req.access?.authenticated) return req.access.companyId ? `co:${req.access.companyId}` : null
    const key = req.get('x-waymark-workspace') ?? ''
    return WORKSPACE_KEY_RE.test(key) ? `ws:${key}` : null
  }
  // An anonymous workspace belongs to whoever holds its key. A signed-in user has the role their company gave them.
  const roleOf = (req) => (req.access?.authenticated ? req.access.role ?? 'viewer' : 'owner')
  const actorOf = (req) => (req.access?.authenticated ? `user:${req.access.userId}` : 'workspace owner')

  const route = (handler, { write = false, admin = false } = {}) => async (req, res) => {
    try {
      const tenant = tenantOf(req)
      if (!tenant) throw new HttpError(400, 'no_workspace', 'This request is not tied to a workspace. Reload the page.')
      const role = roleOf(req)
      if (admin && !canDecide(role)) throw new HttpError(403, 'forbidden', 'Only an owner or admin can do this.')
      if (write && role === 'viewer') throw new HttpError(403, 'forbidden', 'Viewers cannot make changes.')
      await handler(req, res, { tenant, role, actor: actorOf(req) })
    } catch (err) {
      if (res.headersSent) return res.end()
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message })
      if (err instanceof ConfigError) return res.status(400).json({ error: 'invalid_configuration', message: err.message })
      if (err instanceof ApprovalError) return res.status(err.status).json({ error: 'approval_error', message: err.message })
      if (err instanceof ProviderError) return res.status(502).json({ error: err.code, message: err.message })
      if (err instanceof UpstreamError) return res.status(502).json({ error: err.code, message: err.message })
      console.error('[platform]', err)
      res.status(500).json({ error: 'internal_error', message: 'Something went wrong on the server.' })
    }
  }

  async function settingsOf(tenant) {
    const saved = (await store.get(tenant, 'platform_settings', 'settings')) ?? {}
    return { id: 'settings', aiProvider: saved.aiProvider ?? null, sharing: { ...DEFAULT_SHARING, ...saved.sharing }, monitor: { ...DEFAULT_MONITOR, ...saved.monitor } }
  }

  const weather = async (lat, lon) => {
    const key = `${Number(lat).toFixed(1)},${Number(lon).toFixed(1)}`
    const hit = weatherCache.get(key)
    if (hit) return hit
    const value = await fetchWeather(config, { lat, lon })
    weatherCache.set(key, value)
    return value
  }
  const news = async (category) => {
    const id = NEWS_CATEGORIES.some((c) => c.id === category) ? category : 'disruption'
    const hit = newsCache.get(id)
    if (hit) return hit
    const value = await fetchWorldNews(config, id, fetchImpl)
    newsCache.set(id, value)
    return value
  }

  /** Everything the agent's tools may touch for one request. */
  async function toolContext(tenant, body, plan = 'free') {
    const { ws, fx, model } = readWorkspace(body)
    const settings = await settingsOf(tenant)
    return {
      settings,
      ctx: {
        tenant, ws, fx, model, config, canFeature: feature => can(plan, feature), weather: body.demoScenario === 'weather' && model.company.isDemo ? async () => ({ source: 'Simulated demo forecast', simulated: true, retrievedAt: new Date().toISOString(), alerts: [], days: [] }) : weather, news,
        data: await integrations.datasets(tenant),
        sharing: settings.sharing,
        track: (shipment) => can(plan, 'tracking.live') ? integrations.track(tenant, shipment) : Promise.resolve({ available: false, reason: 'Provider tracking requires the Pro plan.' }),
        requestApproval: (request) => approvals.request(tenant, request),
        // The scripted weather disruption exists only for fictional demo companies.
        demoScenario: body.demoScenario === 'weather' && model.company.isDemo ? demoWeatherScenario(model) : null,
      },
    }
  }

  async function llmList(tenant) {
    const views = await Promise.all(LLM_PROVIDER_IDS.map((id) => integrations.get(tenant, id)))
    return views.map((v) => ({ id: v.id, label: LLM_PROVIDERS[v.id].label, vendor: LLM_PROVIDERS[v.id].vendor, status: v.status, statusLabel: v.statusLabel, model: v.model, health: v.health, capabilities: v.capabilities, ready: v.status === 'connected' }))
  }

  const saveRun = async (tenant, run) => {
    const { toolCalls, ...rest } = run
    await store.put(tenant, 'agent_runs', { ...rest, toolCallCount: toolCalls.length, toolCalls })
    for (const call of toolCalls) await store.put(tenant, 'agent_tool_calls', { id: `${run.id}:${call.id}`, runId: run.id, name: call.name, status: call.status, at: call.at, durationMs: call.durationMs, summary: call.summary })
    return run
  }

  const monitor = createMonitor({
    store,
    investigate: async ({ tenant, ctx, task, directive, actor }) => saveRun(tenant, await runAgent({ task, ctx, provider: null, trigger: 'monitor', actor, directive, fetchImpl })),
    // A channel gets a draft only if it is connected and the user left that category switched on.
    channelsFor: async (tenant, category) => {
      const out = []
      for (const channel of Object.keys(CHANNELS)) {
        const prefs = await notifier.preferences(tenant, channel)
        if (prefs.enabled && prefs.categories[category] !== false && (await integrations.statusOf(tenant, channel)) === 'connected') out.push(channel)
      }
      return out
    },
  })
  monitor.start(config.monitorIntervalMinutes, async tenant => {
    const saved = await store.get(tenant, 'platform_settings', 'monitor_snapshot')
    const body = saved?.sealed && vault.open(saved.sealed)
    if (!body) return null
    const { ctx, settings } = await toolContext(tenant, body, await store.planOf(tenant, saved.plan ?? 'free'))
    return { ctx, settings: settings.monitor }
  })

  /* ---------- Body parsing ---------- */

  // Workspace snapshots are larger than the 256 kB the rest of the API accepts.
  const bigJson = express.json({ limit: '4mb' })

  /* ---------- Overview ---------- */

  app.get('/api/platform/summary', route(async (req, res, { tenant }) => {
    const [list, settings, runs, alertList, pending, state] = await Promise.all([integrations.list(tenant), settingsOf(tenant), store.list(tenant, 'agent_runs'), monitor.alerts(tenant), approvals.pendingCount(tenant), monitor.stateOf(tenant)])
    const external = list.filter((i) => integrationById(i.id).auth !== 'builtin')
    const live = external.filter((i) => i.status === 'connected')
    const llms = list.filter((i) => LLM_PROVIDER_IDS.includes(i.id))
    const preferred = llms.find((i) => i.id === settings.aiProvider && i.status === 'connected') ?? llms.find((i) => i.status === 'connected') ?? null
    res.json({
      integrations: { connected: live.length, demo: external.filter((i) => i.status === 'demo').length, errors: external.filter((i) => i.status === 'error').length, total: external.length, lastSyncAt: list.map((i) => i.lastSyncAt).filter(Boolean).sort().pop() ?? null, names: live.map((i) => integrationById(i.id).name) },
      ai: { provider: preferred ? { id: preferred.id, label: LLM_PROVIDERS[preferred.id].label, model: preferred.model } : null, fallback: 'Built-in planner', configured: llms.filter((i) => i.status === 'connected').length },
      agent: { health: runs.length && runs[runs.length - 1].status === 'failed' ? 'degraded' : 'ready', recent: runs.slice(-3).reverse().map((r) => ({ id: r.id, task: r.task, status: r.status, providerLabel: r.providerLabel, finishedAt: r.finishedAt, trigger: r.trigger })) },
      monitor: { ...state, enabled: settings.monitor.enabled, scheduled: Boolean(config.monitorIntervalMinutes), intervalMinutes: config.monitorIntervalMinutes },
      alerts: alertList.filter((a) => a.status === 'open').slice(0, 6),
      pendingApprovals: pending,
    })
  }))

  /* ---------- Integrations ---------- */

  app.get('/api/integrations', route(async (req, res, { tenant }) => {
    res.json({ integrations: await integrations.list(tenant), redirectUri: integrations.redirectUri, credentialStorage: vault.persistent ? 'persistent' : 'temporary', stateStorage: store.kind })
  }))

  // The provider sends the browser here after its consent screen. The state value ties it to the workspace that started.
  app.get('/api/integrations/oauth/callback', async (req, res) => {
    try {
      res.redirect(302, await integrations.oauthCallback(req.query))
    } catch (err) {
      console.error('[oauth]', err.message)
      res.redirect(302, `${config.appBaseUrl}/app/integrations?error=exchange`)
    }
  })

  app.get('/api/integrations/slack/channels', route(async (req, res, { tenant }) => res.json({ channels: await integrations.slackChannels(tenant) })))

  app.post('/api/integrations/import-log', route(async (req, res, { tenant, actor }) => {
    res.json({ job: await integrations.recordImport(tenant, { format: req.body?.format, summary: req.body?.summary }, actor) })
  }, { write: true }))

  app.get('/api/integrations/:id/activity', route(async (req, res, { tenant }) => {
    if (!integrationById(req.params.id)) throw new HttpError(404, 'not_found', 'Unknown integration.')
    res.json({ events: await integrations.events(tenant, req.params.id), jobs: await integrations.jobs(tenant, req.params.id) })
  }))

  app.post('/api/integrations/:id/connect', route(async (req, res, { tenant, actor }) => res.json(await integrations.connect(tenant, req.params.id, req.body ?? {}, actor)), { admin: true }))
  app.post('/api/integrations/:id/test', route(async (req, res, { tenant, actor }) => res.json(await integrations.test(tenant, req.params.id, actor)), { write: true }))
  app.post('/api/integrations/:id/demo', bigJson, route(async (req, res, { tenant, actor }) => res.json({ integration: await integrations.enableDemo(tenant, req.params.id, readWorkspace(req.body).ws, actor) }), { admin: true }))
  app.post('/api/integrations/:id/sync', bigJson, route(async (req, res, { tenant, actor }) => res.json(await integrations.sync(tenant, req.params.id, { actor, ws: req.body?.workspace ? readWorkspace(req.body).ws : null })), { write: true }))
  app.patch('/api/integrations/:id', route(async (req, res, { tenant, actor }) => res.json({ integration: await integrations.configure(tenant, req.params.id, req.body ?? {}, actor) }), { admin: true }))
  app.delete('/api/integrations/:id', route(async (req, res, { tenant, actor }) => res.json({ integration: await integrations.disconnect(tenant, req.params.id, actor) }), { admin: true }))

  // Shopify calls this when shop data changes. The body is authenticated by its signature, not by a session.
  app.post('/api/webhooks/shopify', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
    if (!verifyShopifyWebhook(config.shopifyWebhookSecret, raw, req.get('x-shopify-hmac-sha256'))) return res.status(401).json({ error: 'bad_signature', message: 'The webhook signature is not valid.' })
    const matched = await integrations.shopifyWebhook(String(req.get('x-shopify-shop-domain') ?? '').toLowerCase(), req.get('x-shopify-topic'))
    res.status(200).json({ ok: true, matched })
  })

  /* ---------- Business data ---------- */

  app.get('/api/business/data', route(async (req, res, { tenant }) => res.json(await integrations.datasets(tenant))))
  app.post('/api/business/mappings', route(async (req, res, { tenant, actor }) => res.json({ mapping: await integrations.saveMapping(tenant, req.body, actor) }), { write: true }))
  app.delete('/api/business/mappings/:id', route(async (req, res, { tenant }) => {
    await integrations.removeMapping(tenant, req.params.id)
    res.json({ ok: true })
  }, { write: true }))

  app.post('/api/logistics/track', route(async (req, res, { tenant }) => {
    if (!can(req.access.plan, 'tracking.live')) throw new HttpError(403, 'plan_upgrade_required', 'Provider tracking requires the Pro plan.')
    const s = req.body?.shipment
    if (!s || typeof s !== 'object' || typeof s.reference !== 'string') throw new HttpError(400, 'invalid_input', 'A shipment is required.')
    const pick = (key, max = 40) => (s[key] == null ? null : String(s[key]).slice(0, max))
    const legs = Array.isArray(s.legs) ? s.legs.slice(0, 6).map((l) => ({ mode: String(l?.mode ?? '').slice(0, 8), from: { name: String(l?.from?.name ?? '').slice(0, 80) }, to: { name: String(l?.to?.name ?? '').slice(0, 80) } })) : []
    res.json(await integrations.track(tenant, { reference: pick('reference'), containerNo: pick('containerNo'), awb: pick('awb'), billOfLading: pick('billOfLading'), vesselImo: pick('vesselImo', 12), vesselMmsi: pick('vesselMmsi', 12), mode: pick('mode', 8), status: pick('status', 20), eta: pick('eta', 12), legs }))
  }))

  /* ---------- AI providers and settings ---------- */

  app.get('/api/ai/providers', route(async (req, res, { tenant }) => {
    const settings = await settingsOf(tenant)
    res.json({ providers: await llmList(tenant), preferred: settings.aiProvider, sharing: settings.sharing, tools: TOOLS.map((t) => ({ name: t.name, description: t.description.split('. ')[0], external: Boolean(t.external), sharing: t.sharing ?? null })), limits: { maxSteps: config.agentMaxSteps, maxToolCalls: config.agentMaxToolCalls } })
  }))

  app.put('/api/settings', route(async (req, res, { tenant }) => {
    const current = await settingsOf(tenant)
    const patch = req.body ?? {}
    const next = { ...current }
    if (patch.aiProvider === null || LLM_PROVIDER_IDS.includes(patch.aiProvider)) next.aiProvider = patch.aiProvider
    if (patch.sharing && typeof patch.sharing === 'object') for (const key of Object.keys(DEFAULT_SHARING)) if (typeof patch.sharing[key] === 'boolean') next.sharing[key] = patch.sharing[key]
    if (patch.monitor && typeof patch.monitor === 'object') {
      for (const key of ['enabled', 'delays', 'weather', 'news', 'inventory']) if (typeof patch.monitor[key] === 'boolean') next.monitor[key] = patch.monitor[key]
      if (['medium', 'high'].includes(patch.monitor.minLevel)) next.monitor.minLevel = patch.monitor.minLevel
      if (Number.isFinite(Number(patch.monitor.costThresholdCad))) next.monitor.costThresholdCad = Math.min(100_000_000, Math.max(0, Math.round(Number(patch.monitor.costThresholdCad))))
    }
    await store.put(tenant, 'platform_settings', next)
    res.json({ settings: next })
  }, { admin: true }))

  /* ---------- Agent ---------- */

  const takeAgentRun = (tenant, usesModel) => {
    const minute = Math.floor(Date.now() / 60_000)
    const key = `${tenant}:${minute}`
    if (agentRate.size > 5000) agentRate.clear()
    agentRate.set(key, (agentRate.get(key) ?? 0) + 1)
    if (agentRate.get(key) > 12) throw new HttpError(429, 'rate_limited', 'Too many investigations at once. Try again in a minute.')
    if (!usesModel) return
    const day = `${tenant}:${new Date().toISOString().slice(0, 10)}`
    if (aiDaily.size > 5000) aiDaily.clear()
    if ((aiDaily.get(day) ?? 0) >= config.aiDailyLimit) throw new HttpError(429, 'usage_limit', 'The daily AI allowance for this workspace is used up. The built-in planner still works.')
    aiDaily.set(day, (aiDaily.get(day) ?? 0) + 1)
  }

  app.post('/api/agent/run', bigJson, route(async (req, res, { tenant, role, actor }) => {
    const task = typeof req.body?.task === 'string' ? req.body.task.trim() : ''
    if (task.length < 3 || task.length > 800) throw new HttpError(400, 'invalid_input', 'Describe the task in 3 to 800 characters.')
    const { ctx, settings } = await toolContext(tenant, req.body, req.access.plan)

    // The provider is the one the user picked for this run, or their saved preference. No other provider is contacted.
    const wanted = req.body.provider === 'planner' ? null : LLM_PROVIDER_IDS.includes(req.body.provider) ? req.body.provider : settings.aiProvider
    let provider = null
    if (wanted) {
      if ((await integrations.statusOf(tenant, wanted)) !== 'connected') throw new HttpError(409, 'provider_not_ready', `${LLM_PROVIDERS[wanted].label} is not configured. Choose another model or the built-in planner.`)
      provider = await integrations.llmProvider(tenant, wanted)
    }
    takeAgentRun(tenant, Boolean(provider))
    // Viewers may investigate, but may not ask for anything to be sent.
    const allowedTools = TOOLS.filter((t) => !(t.external && role === 'viewer')).map((t) => t.name)

    const stream = (req.get('accept') ?? '').includes('text/event-stream')
    let emit = () => {}
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      emit = (event, payload) => {
        if (event !== 'done' && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
      }
    }
    const run = await saveRun(tenant, await runAgent({ task, ctx, provider, emit, actor, fetchImpl, allowedTools }))
    if (!stream) return res.json({ run })
    res.write(`event: done\ndata: ${JSON.stringify(run)}\n\n`)
    res.end()
  }, { write: false }))

  app.get('/api/agent/runs', route(async (req, res, { tenant }) => {
    const runs = (await store.list(tenant, 'agent_runs')).reverse().slice(0, 40)
    res.json({ runs: runs.map(({ toolCalls, result, reports, ...r }) => ({ ...r, summary: result?.summary?.slice(0, 220) ?? null, confidence: result?.confidence?.level ?? null, tools: [...new Set((toolCalls ?? []).map((c) => c.name))] })) })
  }))

  app.get('/api/agent/runs/:id', route(async (req, res, { tenant }) => {
    const run = await store.get(tenant, 'agent_runs', req.params.id)
    if (!run) throw new HttpError(404, 'not_found', 'Investigation not found.')
    res.json({ run })
  }))

  /* ---------- Monitoring ---------- */

  app.get('/api/monitor', route(async (req, res, { tenant }) => {
    const [state, alertList, settings, runs] = await Promise.all([monitor.stateOf(tenant), monitor.alerts(tenant), settingsOf(tenant), store.list(tenant, 'agent_runs')])
    res.json({
      state: { ...state, running: monitor.isRunning(tenant), scheduled: Boolean(config.monitorIntervalMinutes), intervalMinutes: config.monitorIntervalMinutes },
      settings: settings.monitor,
      alerts: alertList.slice(0, 60),
      investigations: runs.filter((r) => r.trigger === 'monitor').reverse().slice(0, 15).map(({ result, reports, ...r }) => ({ ...r, summary: result?.summary ?? null, recommendations: result?.recommendations ?? [] })),
      toolHistory: (await store.list(tenant, 'agent_tool_calls')).reverse().slice(0, 40),
    })
  }))

  app.post('/api/monitor/run', bigJson, route(async (req, res, { tenant, actor }) => {
    if (monitor.isRunning(tenant)) throw new HttpError(409, 'already_running', 'A monitoring run is already in progress.')
    const { ctx, settings } = await toolContext(tenant, req.body, req.access.plan)
    const auto = req.body.trigger === 'auto'
    if (auto && !settings.monitor.enabled) return res.json({ skipped: true, reason: 'Monitoring is turned off.' })
    const previous = await monitor.stateOf(tenant)
    if (auto && previous.lastRunAt && Date.now() - Date.parse(previous.lastRunAt) < 30 * 60_000) return res.json({ skipped: true, reason: 'Automatic monitoring ran within the last 30 minutes.' })
    // Persist an encrypted authorized snapshot so a single server can recover its schedule after restart.
    if (config.monitorIntervalMinutes && vault.persistent) await store.put(tenant, 'platform_settings', { id: 'monitor_snapshot', sealed: vault.seal({ workspace: ctx.ws, fx: ctx.fx }), plan: req.access.plan, savedAt: new Date().toISOString() })
    else if (config.monitorIntervalMinutes) monitor.remember(tenant, async () => ({ ctx: { ...ctx, data: await integrations.datasets(tenant) }, settings: (await settingsOf(tenant)).monitor }))
    res.json(await monitor.run(tenant, ctx, settings.monitor, { trigger: auto ? 'auto' : 'manual', actor }))
  }, { write: true }))

  app.post('/api/monitor/alerts/:id', route(async (req, res, { tenant }) => {
    const alert = await monitor.setAlertStatus(tenant, req.params.id, req.body?.status)
    if (!alert) throw new HttpError(404, 'not_found', 'Alert not found.')
    res.json({ alert })
  }, { write: true }))

  /* ---------- Approvals ---------- */

  app.get('/api/approvals', route(async (req, res, { tenant, role }) => res.json({ approvals: await approvals.list(tenant), canDecide: canDecide(role) })))

  app.post('/api/approvals/:id/decision', route(async (req, res, { tenant, role, actor }) => {
    res.json({ approval: await approvals.decide(tenant, req.params.id, { decision: req.body?.decision, note: req.body?.note, actor, role }) })
  }, { write: true }))

  /* ---------- Notifications ---------- */

  app.get('/api/notifications', route(async (req, res, { tenant }) => {
    const preferences = {}
    for (const channel of Object.keys(CHANNELS)) preferences[channel] = await notifier.preferences(tenant, channel)
    res.json({ preferences, deliveries: (await notifier.deliveries(tenant)).slice(0, 60), categories: NOTIFICATION_CATEGORIES })
  }))

  app.put('/api/notifications/:channel', route(async (req, res, { tenant, actor }) => res.json({ preferences: await notifier.savePreferences(tenant, req.params.channel, req.body ?? {}, actor) }), { admin: true }))

  app.post('/api/notifications/:channel/test', route(async (req, res, { tenant, actor }) => {
    const delivery = await notifier.sendTest(tenant, req.params.channel, { actor, appBaseUrl: config.appBaseUrl })
    res.status(delivery.status === 'sent' ? 200 : 502).json({ delivery, integration: await integrations.get(tenant, req.params.channel) })
  }, { write: true }))

  return { store, integrations, approvals, notifier, catalogue: INTEGRATIONS, newToken: randomToken }
}
