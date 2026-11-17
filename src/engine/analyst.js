/*
  AI Trade Analyst, the deterministic half.

  A context item is a small card describing one thing the user picked: a
  shipment, supplier, product, alert, news headline, country or hub. From the
  picked items this module works out, with fixed rules, which of the company's
  records are involved and what the existing engines say about them. The AI
  only puts these findings into words. Without AI, `ruleAnswer` writes the
  answer from the same findings.

  Every figure carries its kind: actual, derived, assumption or missing.
*/
import { formatCo2e } from '../../shared/emissions.js'
import { countryOf } from '../../shared/countries.js'
import { findPlace } from '../../shared/places.js'
import { money } from '../utils/format.js'
import { planDelayResponse } from './delayPlan.js'
import { articleSignals, matchExposure } from './exposure.js'
import { modeLabel, statusLabel } from './model.js'
import { runScenario } from './simulator.js'

export const ITEM_TYPES = {
  shipment: { label: 'Shipment', icon: 'ship' },
  supplier: { label: 'Supplier', icon: 'users' },
  product: { label: 'Product', icon: 'box' },
  alert: { label: 'Risk alert', icon: 'alert' },
  news: { label: 'News', icon: 'newspaper' },
  country: { label: 'Country', icon: 'globe' },
  hub: { label: 'Port or airport', icon: 'anchor' },
  warehouse: { label: 'Warehouse', icon: 'building' },
}

const key = (type, id) => `${type}:${id}`

/** Builds the card for a record. Returns null when the record is not in this company's model. */
export function contextItem(type, id, model, extra = {}) {
  const base = { key: key(type, id), type, id }
  if (type === 'shipment') {
    const s = model.shipments.find((x) => x.id === id)
    if (!s) return null
    const from = s.legs[0]?.from?.name
    const to = s.legs[s.legs.length - 1]?.to?.name
    return {
      ...base,
      title: s.reference,
      summary: `${modeLabel(s.mode)} ${s.direction === 'export' ? 'export' : 'import'}${from && to ? `, ${from} to ${to}` : ''}. ${statusLabel(s.status)}, ETA ${s.eta ?? 'unknown'}.`,
      source: s.dataSource === 'demo' ? 'Demo shipment record' : 'Shipment record',
      link: '/app/shipments',
      facts: { reference: s.reference, status: s.status, mode: s.mode, eta: s.eta ?? null, supplier: s.supplier?.name ?? null, product: s.product?.name ?? null, quantity: s.quantity ?? null, freightCostCad: s.costCad ?? null },
    }
  }
  if (type === 'supplier') {
    const s = model.supplierById.get(id)
    if (!s) return null
    return {
      ...base,
      title: s.name,
      summary: `${s.countryInfo?.name ?? s.country}. ${Math.round(s.share * 100)}% of sourcing${s.leadTimeDays ? `, ${s.leadTimeDays}-day lead time` : ''}.`,
      source: 'Supplier record',
      link: '/app/settings',
      facts: { name: s.name, country: s.countryInfo?.name ?? s.country, sourcingSharePct: Math.round(s.share * 100), annualSpendCad: Math.round(s.spendCad) || null, leadTimeDays: s.leadTimeDays ?? null, mode: s.mode ?? null },
    }
  }
  if (type === 'product') {
    const p = model.products.find((x) => x.id === id)
    if (!p) return null
    return { ...base, title: p.name, summary: `${p.category || 'Product'}${p.hsCode ? `, HS ${p.hsCode}` : ''}.`, source: 'Product record', link: '/app/settings', facts: { name: p.name, hsCode: p.hsCode ?? null, annualQuantity: p.annualQuantity ?? null, onHandUnits: p.onHandUnits ?? null } }
  }
  if (type === 'alert') {
    const a = model.alerts.find((x) => x.id === id)
    if (!a) return null
    return { ...base, title: a.title, summary: a.detail, source: 'Waymark rule-based alert', link: '/app#alerts', facts: { level: a.level, shipmentId: a.shipmentId ?? null } }
  }
  if (type === 'warehouse') {
    const w = model.warehouses.find((x) => x.id === id)
    if (!w) return null
    return { ...base, title: w.name, summary: [w.city, w.province].filter(Boolean).join(', ') || 'Warehouse', source: 'Warehouse record', link: '/app/settings', facts: { name: w.name } }
  }
  if (type === 'country') {
    const c = countryOf(id)
    if (!c) return null
    return { ...base, title: c.name, summary: `${c.region}. ${c.hazard}.`, source: 'Waymark reference data', link: '/app/global', facts: { country: c.name, region: c.region } }
  }
  if (type === 'hub') {
    const h = findPlace(id)
    if (!h) return null
    return { ...base, title: h.name, summary: `${h.kind === 'airport' ? 'Airport' : 'Seaport'} in ${countryOf(h.country)?.name ?? h.country}.`, source: 'Waymark reference data', link: '/app/map', facts: { hub: h.name, code: h.code } }
  }
  if (type === 'news') {
    if (!extra.title || !extra.url) return null
    return {
      ...base,
      title: extra.title,
      summary: `Reported by ${extra.publisher || 'an unnamed publisher'}${extra.publishedAt ? ` on ${String(extra.publishedAt).slice(0, 10)}` : ''}. A headline, not a confirmed effect on your business.`,
      source: extra.publisher || 'News',
      url: extra.url,
      publishedAt: extra.publishedAt ?? null,
      facts: { headline: extra.title, publisher: extra.publisher ?? null, published: extra.publishedAt ? String(extra.publishedAt).slice(0, 10) : null },
    }
  }
  return null
}

/** Rebuilds stored items against the current model, dropping any whose record is gone. News keeps what was stored. */
export function resolveItems(stored, model) {
  return stored.map((item) => (item.type === 'news' ? item : contextItem(item.type, item.id, model))).filter(Boolean)
}

/** A number of days the user asked about, such as "30 days" or "3 weeks". */
function askedDays(question) {
  const m = /(\d{1,3})\s*(day|week)s?/i.exec(question ?? '')
  return m ? Number(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1) : null
}

/**
 * Works out which records the picked items involve and what is known about them.
 * Everything returned here is either a stored value or the output of an existing engine.
 */
export function buildFindings(items, model, question = '') {
  const shipments = new Map()
  const suppliers = new Map()
  const notes = []
  const addShipment = (id, why) => {
    const s = model.shipments.find((x) => x.id === id)
    if (s && !shipments.has(id)) shipments.set(id, { s, why })
  }
  const addSupplier = (id, why) => {
    const s = model.supplierById.get(id)
    if (s && !suppliers.has(id)) suppliers.set(id, { s, why })
  }
  const fromSignals = (signals, label) => {
    const match = matchExposure(signals, model)
    match.suppliers.forEach((x) => addSupplier(x.id, x.why))
    match.shipments.forEach((x) => addShipment(x.id, x.why))
    if (match.level === 'none') notes.push(`${label}: none of your suppliers or active shipments use the place it names.`)
    if (match.level === 'insufficient') notes.push(`${label}: it names no country or hub, so it cannot be matched to your records.`)
  }

  for (const item of items) {
    if (item.type === 'shipment') {
      addShipment(item.id, 'Selected by you')
      const s = model.shipments.find((x) => x.id === item.id)
      if (s?.supplierId) addSupplier(s.supplierId, `Supplies ${s.reference}`)
    } else if (item.type === 'supplier') {
      addSupplier(item.id, 'Selected by you')
      model.shipments.filter((s) => s.active && s.supplierId === item.id).forEach((s) => addShipment(s.id, `Active shipment from ${s.supplier?.name}`))
    } else if (item.type === 'product') {
      model.shipments.filter((s) => s.active && s.productId === item.id).forEach((s) => addShipment(s.id, `Carries ${s.product?.name}`))
      model.suppliers.filter((s) => (s.productIds ?? []).includes(item.id)).forEach((s) => addSupplier(s.id, `Supplies ${item.title}`))
    } else if (item.type === 'alert') {
      const a = model.alerts.find((x) => x.id === item.id)
      if (a?.shipmentId) addShipment(a.shipmentId, 'Named in the alert')
    } else if (item.type === 'warehouse') {
      model.shipments.filter((s) => s.active && s.warehouseId === item.id).forEach((s) => addShipment(s.id, `Bound for ${item.title}`))
    } else if (item.type === 'country') {
      fromSignals({ countries: [item.id], hubs: [], modes: [] }, item.title)
    } else if (item.type === 'hub') {
      fromSignals({ countries: [], hubs: [item.id], modes: [] }, item.title)
    } else if (item.type === 'news') {
      fromSignals(articleSignals(item), `"${item.title}"`)
    }
  }

  const ships = [...shipments.values()]
  const sups = [...suppliers.values()]
  const active = ships.filter((x) => x.s.active)
  const freight = active.reduce((sum, x) => sum + (x.s.costCad ?? 0), 0)
  const spend = sups.reduce((sum, x) => sum + (x.s.spendCad ?? 0), 0)
  const share = sups.reduce((sum, x) => sum + x.s.share, 0)
  const emissionsKg = active.reduce((sum, x) => sum + (x.s.emissions?.co2eKg ?? 0), 0)
  const etas = active.map((x) => x.s.eta).filter(Boolean).sort()
  const delayed = ships.filter((x) => x.s.status === 'delayed')

  // An illustrative delay at the largest involved supplier, from the existing scenario engine.
  const top = [...sups].sort((a, b) => b.s.share - a.s.share)[0]?.s ?? null
  const days = askedDays(question) ?? 30
  let scenario = null
  if (top) {
    const r = runScenario({ type: 'supplier_delay', params: { supplierId: top.id, delayDays: days } }, model)
    scenario = {
      supplier: top.name,
      delayDays: days,
      daysChosenBy: askedDays(question) ? 'your question' : 'an illustrative 30-day assumption',
      inventoryShortfallDays: r.inventoryShortfallDays,
      totalCostCad: Math.round(r.totalCost),
      shortageCostCad: Math.round(r.shortageCost),
      delayCosted: r.delayCosted,
      options: r.strategies.map((st) => ({ name: st.name, totalCad: Math.round(st.total), daysWithoutStock: st.uncoveredDays, feasibility: st.feasibility?.level ?? null, co2eChangeKg: st.co2eChangeKg == null ? null : Math.round(st.co2eChangeKg) })),
      lowestCost: r.strategies.find((st) => st.id === r.lowestCostId)?.name ?? null,
    }
  }

  // A shipment-level plan for each delayed shipment whose delay has been confirmed in Delay Assist.
  const delayPlans = delayed
    .filter((x) => x.s.delayDays != null && x.s.readiness)
    .map((x) => {
      const plan = planDelayResponse(x.s, model, { useCompanyDefaultInventory: x.s.usedDefaultInventory === true })
      const rec = plan.options.find((o) => o.id === plan.recommendedId)
      return { reference: x.s.reference, delayDays: plan.inputs.delayDays, daysWithoutStock: plan.uncoveredDays, recommended: rec?.name ?? null, extraCostCad: rec?.extraCostCad ?? null }
    })

  const unknowns = []
  if (!items.length) unknowns.push('Nothing is selected yet.')
  if (model.resolved.bufferDays == null) unknowns.push('Days of stock on hand are not recorded.')
  if (!model.company.operations?.dailyShortfallCost) unknowns.push('No cost per day out of stock is set, so shortages are not costed.')
  if (active.some((x) => x.s.costCad == null)) unknowns.push('Some involved shipments have no freight cost recorded.')
  if (delayed.some((x) => x.s.delayDays == null)) unknowns.push('A delayed shipment has no confirmed delay length. Delay Assist can record it.')
  if (items.some((i) => i.type === 'news')) unknowns.push('A headline does not say whether your own shipments are affected. Check with your carrier or supplier.')

  return {
    shipments: ships.map(({ s, why }) => ({ id: s.id, reference: s.reference, status: statusLabel(s.status), mode: modeLabel(s.mode), eta: s.eta ?? null, supplier: s.supplier?.name ?? null, freightCostCad: s.costCad ?? null, why })),
    suppliers: sups.map(({ s, why }) => ({ id: s.id, name: s.name, country: s.countryInfo?.name ?? s.country, sourcingSharePct: Math.round(s.share * 100), annualSpendCad: Math.round(s.spendCad) || null, why })),
    money: {
      activeShipmentFreightCad: { value: active.length ? Math.round(freight) : null, kind: 'actual', note: 'Recorded freight on the involved active shipments' },
      supplierAnnualSpendCad: { value: sups.length ? Math.round(spend) : null, kind: 'derived', note: 'Yearly spend with the involved suppliers' },
      sourcingSharePct: { value: sups.length ? Math.round(share * 100) : null, kind: 'derived', note: 'Share of your sourcing they carry' },
    },
    inventory: { daysOfStock: model.resolved.bufferDays ?? null, kind: model.resolved.bufferDays == null ? 'missing' : model.resolved.provenance?.bufferDays ?? 'assumption', note: 'Company-wide figure, not per product' },
    timing: { earliestEta: etas[0] ?? null, delayedShipments: delayed.map((x) => x.s.reference), leadTimeDays: model.resolved.leadTimeDays ?? null },
    carbon: { activeShipmentKg: active.length ? Math.round(emissionsKg) : null, kind: 'derived', note: 'Estimated transport emissions of the involved active shipments' },
    scenario,
    delayPlans,
    notes,
    unknowns,
  }
}

/** Next steps that fit the findings. These are options to consider, never decisions. */
export function nextSteps(findings) {
  const steps = []
  if (findings.timing.delayedShipments.length) steps.push({ label: `Resolve the delay on ${findings.timing.delayedShipments[0]}`, to: 'delay', reference: findings.timing.delayedShipments[0] })
  if (findings.shipments.length) steps.push({ label: 'Ask the carrier or supplier to confirm the status of the involved shipments', to: null })
  if (findings.suppliers.length) steps.push({ label: 'Test a longer delay or a shutdown in the Risk Simulator', to: '/app/simulator' })
  if (findings.suppliers.length) steps.push({ label: 'Compare alternative suppliers for the same product', to: '/app/canadian' })
  if (findings.shipments.length) steps.push({ label: 'See the involved routes on the map', to: '/app/map' })
  if (!findings.shipments.length && !findings.suppliers.length) steps.push({ label: 'Keep monitoring. No record of yours is involved so far', to: '/app/world' })
  return steps
}

const list = (values) => (values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`)

/** The answer written from the findings alone. Used when no AI is available, and shown beside any AI answer. */
export function ruleAnswer(question, items, findings) {
  if (!items.length) return 'Add a shipment, supplier, headline or other item to the context, then ask again.'
  const out = []
  const s = findings.shipments
  const u = findings.suppliers
  if (!s.length && !u.length) {
    out.push('None of your suppliers or active shipments match the selected items, so no exposure is identified from your records.')
  } else {
    const parts = []
    if (s.length) parts.push(`${s.length} shipment${s.length > 1 ? 's' : ''} (${list(s.slice(0, 5).map((x) => x.reference))})`)
    if (u.length) parts.push(`${u.length} supplier${u.length > 1 ? 's' : ''} (${list(u.slice(0, 4).map((x) => x.name))})`)
    out.push(`Your records involve ${parts.join(' and ')}. ${items.some((i) => i.type === 'news') ? 'A headline shows possible exposure only: it does not confirm that these are affected.' : ''}`.trim())
  }
  const m = findings.money
  const money$ = []
  if (m.activeShipmentFreightCad.value != null) money$.push(`${money(m.activeShipmentFreightCad.value)} of recorded freight is on the involved active shipments`)
  if (m.supplierAnnualSpendCad.value) money$.push(`the involved suppliers carry ${m.sourcingSharePct.value}% of your sourcing (${money(m.supplierAnnualSpendCad.value)} a year)`)
  if (money$.length) out.push(`From your records: ${list(money$)}.`)
  const sc = findings.scenario
  if (sc) {
    out.push(
      `As an estimate, a ${sc.delayDays}-day delay at ${sc.supplier} (${sc.daysChosenBy}) would leave about ${sc.inventoryShortfallDays} days without stock and cost about ${money(sc.totalCostCad)} over twelve months${sc.delayCosted ? '' : ', with shortages not costed'}. The lowest-cost response in that scenario is "${sc.lowestCost}". These are scenario estimates, not forecasts.`,
    )
  }
  findings.delayPlans.forEach((p) => {
    if (p.recommended) out.push(`${p.reference}: Delay Assist suggests "${p.recommended}"${p.extraCostCad != null ? ` at about ${money(p.extraCostCad)} extra freight` : ''}.`)
  })
  if (findings.carbon.activeShipmentKg) out.push(`The involved active shipments account for an estimated ${formatCo2e(findings.carbon.activeShipmentKg)} of transport emissions.`)
  if (findings.notes.length) out.push(findings.notes.join(' '))
  if (findings.unknowns.length) out.push(`Not known: ${findings.unknowns.join(' ')}`)
  return out.join('\n\n')
}

export function suggestedQuestions(items) {
  const has = (type) => items.some((i) => i.type === type)
  const q = ['How will this situation affect my business?']
  if (has('news') || has('country') || has('hub')) q.push('Which of my shipments could be affected?')
  q.push('What happens if the delay continues for 30 days?', 'What is the least expensive feasible response?')
  if (has('supplier') || has('product')) q.push('Can I use another supplier?')
  if (has('shipment')) q.push('Would changing transportation modes help?')
  q.push('How will this affect my carbon emissions?')
  return q.slice(0, 6)
}

/** The compact, already-computed payload sent to the AI. No raw records beyond what the user picked. */
export const aiFindings = (findings) => ({
  shipments: findings.shipments.slice(0, 8).map(({ id, ...rest }) => rest),
  suppliers: findings.suppliers.slice(0, 6).map(({ id, ...rest }) => rest),
  money: findings.money,
  inventory: findings.inventory,
  timing: findings.timing,
  carbon: findings.carbon,
  scenarioEstimate: findings.scenario,
  delayPlans: findings.delayPlans,
  notes: findings.notes,
  unknown: findings.unknowns,
})
