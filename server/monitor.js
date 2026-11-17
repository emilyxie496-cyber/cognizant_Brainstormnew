/*
  Automated risk monitoring.

  One run: detect changes in the workspace and its live signals, keep only what
  is new, investigate the most serious with the built-in planner, and file an
  approval request for each notification. Nothing leaves Waymark until a person
  approves it, or an owner has switched on automatic sending for that channel.

  Runs are idempotent. Every detected risk has a stable key built from what it
  is about (the shipment and its ETA, the hub and forecast date, the article).
  A key that has been seen before is not alerted, investigated or notified
  again, however often the monitor runs.

  Automated runs always use the built-in planner, never an AI provider, so a
  background job cannot send business data anywhere on its own.
*/
import { inventoryRisk } from '../shared/business.js'
import { articleExposure } from '../src/engine/exposure.js'
import { routePoints } from './agent/tools.js'
import { sha256 } from './crypto.js'

const LEVELS = { low: 0, medium: 1, high: 2 }
const cap = (text, max = 160) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)

export const DEFAULT_MONITOR = { enabled: true, delays: true, weather: true, news: true, inventory: true, minLevel: 'medium', costThresholdCad: 25_000, maxInvestigations: 2 }

/** Every risk visible right now, each with a stable key. Pure apart from the weather and news lookups in ctx. */
export async function detectRisks(ctx, settings) {
  const { model } = ctx
  const found = []
  const errors = []
  const active = model.shipments.filter((s) => s.active)

  if (settings.delays) {
    for (const s of active) {
      if (s.status === 'delayed') found.push({ key: `delay:${s.id}:${s.eta ?? ''}`, category: 'high_risk_shipment', level: 'high', title: `${s.reference} is delayed`, detail: `${s.supplier?.name ?? 'Shipment'}: ETA ${s.eta ?? 'unknown'}.`, shipmentIds: [s.id], source: 'Company records' })
      else if (s.risk.level === 'high') found.push({ key: `risk:${s.id}:${sha256(s.risk.reasons.join('|')).slice(0, 10)}`, category: 'high_risk_shipment', level: 'high', title: `${s.reference} is at high route risk`, detail: s.risk.reasons.join('; '), shipmentIds: [s.id], source: 'Waymark route-risk rules' })
    }
  }

  if (settings.weather) {
    const hubs = new Map()
    for (const s of active) for (const p of routePoints(s)) {
      const key = p.code ?? p.name
      hubs.set(key, { point: p, shipments: [...(hubs.get(key)?.shipments ?? []), s] })
    }
    const busiest = [...hubs.entries()].sort((a, b) => b[1].shipments.length - a[1].shipments.length).slice(0, 6)
    await Promise.all(busiest.map(async ([key, { point, shipments }]) => {
      const scripted = ctx.demoScenario?.hub.name === point.name
      try {
        const w = scripted ? ctx.demoScenario.weather : await ctx.weather(point.lat, point.lon)
        for (const a of w.alerts) {
          found.push({
            key: `weather:${key}:${a.date}:${a.kind}`, category: 'weather_disruption', level: 'medium', simulated: Boolean(w.simulated),
            title: `${a.kind} forecast near ${point.name}`, detail: `Forecast for ${a.date}. ${shipments.length} active shipment(s) route through ${point.name}. A forecast is possible exposure, not a confirmed delay.`,
            shipmentIds: (scripted ? shipments.filter((s) => s.id === ctx.demoScenario.shipmentId) : shipments).map((s) => s.id), source: w.source, forecastAt: w.retrievedAt,
          })
        }
      } catch {
        errors.push(`Weather for ${point.name} could not be checked.`)
      }
    }))
  }

  if (settings.news) {
    try {
      const feed = await ctx.news('disruption')
      for (const article of feed.articles) {
        const exposure = articleExposure(article, model)
        if (exposure.level !== 'potential' || !exposure.shipments.length) continue
        found.push({
          key: `news:${sha256(article.url).slice(0, 16)}`, category: 'high_risk_shipment', level: 'medium',
          title: cap(article.title, 160), detail: `Reported by ${cap(article.publisher, 60) || 'an unnamed publisher'}. ${exposure.shipments.slice(0, 3).map((s) => `${s.reference}: ${s.why}`).join('; ')}. A headline is a report, not a confirmed effect.`,
          shipmentIds: exposure.shipments.map((s) => s.id), source: feed.source, url: article.url, publishedAt: article.publishedAt, thirdParty: true,
        })
        if (found.filter((f) => f.key.startsWith('news:')).length >= 5) break
      }
    } catch {
      errors.push('The news sources could not be checked.')
    }
  }

  if (settings.inventory) {
    const inventory = inventoryRisk(ctx.data.commerce, ctx.data.mappings, model)
    for (const row of inventory?.rows ?? []) {
      if (row.supplyRisk !== 'delayed_supply' || row.level === 'ok') continue
      const refs = row.inbound.filter((s) => s.atRisk)
      found.push({
        key: `inventory:${row.variantId}:${row.level}:${refs.map((s) => s.reference).join(',')}`, category: 'inventory_risk', level: row.level === 'low' ? 'medium' : 'high', simulated: inventory.demo,
        title: `${cap(row.title, 80)} is short of stock behind a delayed shipment`, detail: `${row.onHand} on hand against ${row.openDemand} on open orders. Depends on ${refs.map((s) => s.reference).join(', ')}.`,
        shipmentIds: refs.map((s) => s.id), source: inventory.source,
      })
    }
  }

  const refs = new Map(model.shipments.map((s) => [s.id, s.reference]))
  return { errors, risks: found.map((f) => ({ ...f, shipmentRefs: f.shipmentIds.map((id) => refs.get(id)).filter(Boolean) })) }
}

export function createMonitor({ store, investigate, channelsFor }) {
  const running = new Set()
  const snapshots = new Map() // tenant -> a function that rebuilds the context, for scheduled runs. Memory only.

  const stateOf = async (tenant) => (await store.get(tenant, 'platform_settings', 'monitor_state')) ?? { id: 'monitor_state', lastRunAt: null, lastSuccessAt: null, lastError: null, runs: 0 }
  const alerts = async (tenant) => (await store.list(tenant, 'risk_alerts')).reverse()

  /**
   * @param ctx      the same tool context an agent run gets
   * @param settings the tenant's monitor settings
   */
  async function run(tenant, ctx, settings, { trigger = 'manual', actor = 'user' } = {}) {
    if (running.has(tenant)) return { skipped: true, reason: 'A monitoring run is already in progress.' }
    running.add(tenant)
    let state = { id: 'monitor_state' }
    const startedAt = new Date().toISOString()
    try {
      state = await stateOf(tenant)
      const { risks, errors } = await detectRisks(ctx, settings)
      const known = new Set((await store.list(tenant, 'risk_alerts')).map((a) => a.key))
      const fresh = []
      for (const risk of risks) {
        if (known.has(risk.key)) continue
        known.add(risk.key)
        fresh.push(await store.put(tenant, 'risk_alerts', { ...risk, id: sha256(`${tenant}:${risk.key}`).slice(0, 18), status: 'open', detectedAt: startedAt, trigger, runId: null, approvalIds: [] }))
      }

      // Investigate the most serious new alerts that name a shipment and clear the configured threshold.
      const worthIt = fresh.filter((a) => LEVELS[a.level] >= LEVELS[settings.minLevel] && a.shipmentIds.length).sort((a, b) => LEVELS[b.level] - LEVELS[a.level]).slice(0, settings.maxInvestigations)
      const investigations = []
      for (const alert of worthIt) {
        const draft = await channelsFor(tenant, alert.category)
        const result = await investigate({
          tenant, ctx,
          task: `Automated check of ${alert.shipmentRefs[0]}: ${alert.thirdParty ? 'a news report names a place on its route' : alert.title}`,
          directive: { intent: alert.category === 'weather_disruption' ? 'weather' : alert.category === 'inventory_risk' ? 'customers' : 'at_risk', shipmentId: alert.shipmentIds[0], draft, category: alert.category, alertId: alert.id },
          actor,
        })
        const cost = result.toolCalls.find((c) => c.status === 'ok' && ['run_risk_simulation', 'calculate_financial_impact'].includes(c.name))?.output?.totalAddedCostCad ?? null
        const overThreshold = cost != null && settings.costThresholdCad > 0 && cost >= settings.costThresholdCad
        await store.put(tenant, 'risk_alerts', { ...alert, runId: result.id, approvalIds: result.approvalIds, costImpactCad: cost, overCostThreshold: overThreshold, level: overThreshold ? 'high' : alert.level, recommendation: result.result?.recommendations?.[0] ?? null })
        investigations.push({ alertId: alert.id, runId: result.id, status: result.status, approvals: result.approvalIds.length })
      }

      const next = { ...state, lastRunAt: startedAt, lastSuccessAt: new Date().toISOString(), lastError: errors.length ? errors.join(' ') : null, runs: (state.runs ?? 0) + 1, lastSummary: { detected: risks.length, new: fresh.length, investigated: investigations.length, trigger } }
      await store.put(tenant, 'platform_settings', next)
      return { state: next, detected: risks.length, newAlerts: fresh.length, investigations, errors }
    } catch (err) {
      console.error('[monitor]', err.message)
      const next = { ...state, lastRunAt: startedAt, lastError: 'The monitoring run failed before it could finish.', runs: (state.runs ?? 0) + 1 }
      await store.put(tenant, 'platform_settings', next)
      return { state: next, detected: 0, newAlerts: 0, investigations: [], errors: [next.lastError] }
    } finally {
      running.delete(tenant)
    }
  }

  async function setAlertStatus(tenant, id, status) {
    const alert = await store.get(tenant, 'risk_alerts', id)
    if (!alert || !['open', 'dismissed'].includes(status)) return null
    return store.put(tenant, 'risk_alerts', { ...alert, status })
  }

  /** Keeps the last workspace a browser supplied, so the timer has something to check. Never written to disk. */
  function remember(tenant, rebuild) {
    if (snapshots.size > 500) snapshots.clear()
    snapshots.set(tenant, rebuild)
  }

  function start(intervalMinutes, restore) {
    if (!intervalMinutes) return null
    const timer = setInterval(async () => {
      try {
      const tenants = new Set([...snapshots.keys(), ...(restore ? await store.tenants() : [])])
      for (const tenant of tenants) {
        try {
          const rebuilt = snapshots.has(tenant) ? await snapshots.get(tenant)() : await restore(tenant)
          if (!rebuilt) continue
          const { ctx, settings } = rebuilt
          if (settings.enabled) await run(tenant, ctx, settings, { trigger: 'scheduled', actor: 'scheduler' })
        } catch (err) {
          console.error('[monitor] scheduled run failed:', err.message)
        }
      }
      } catch (err) { console.error('[monitor] scheduler lookup failed:', err.message) }
    }, intervalMinutes * 60_000)
    timer.unref?.()
    return timer
  }

  return { run, stateOf, alerts, setAlertStatus, remember, start, isRunning: (tenant) => running.has(tenant), scheduledTenants: () => snapshots.size }
}
