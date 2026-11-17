/*
  Delay Assist: what to do about one late shipment.

  The Risk Simulator looks at a whole supplier over twelve months. This looks at
  a single order: how many days of stock are missing, what each response costs
  for this shipment, and its transport-emissions effect. It is a pure function
  with fixed rules, so every figure can be traced and no AI is involved.
*/
import { FALLBACK_FACTORS } from '../../shared/emissions.js'
import { estimateTransitDays } from '../../shared/routing.js'
import { STRATEGY_ASSUMPTIONS } from '../data/demoData.js'
import { runScenario } from './simulator.js'

const DAY_MS = 86_400_000
const num = (value) => {
  const n = Number(value)
  return value === '' || value == null || !Number.isFinite(n) || n < 0 ? null : n
}
const round1 = (n) => Math.round(n * 10) / 10

export const READINESS_LABELS = { ready: 'Ready, waiting for a vessel or space', in_production: 'Still in production', unknown: 'Not sure' }
export const OPTION_NAMES = {
  expedite_partial: 'Split the shipment: fly part by air',
  expedite_full: 'Fly everything',
  split_shipment: 'Fly the quantity the supplier can release',
  wait: 'Wait for everything',
  chase_production: 'Ask for a ready date, ship what is finished',
  alternative: 'Switch supplier',
}

/** The most recent approved decision for a shipment, or null. */
export function delayDecision(events = [], shipmentId) {
  return events.filter((e) => e.shipmentId === shipmentId && e.type === 'human_decision').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null
}

/** A delayed shipment needs action until a person has recorded a decision. */
export function delayState(shipment, events) {
  if (shipment.status !== 'delayed') return null
  return delayDecision(events, shipment.id) ? 'resolved' : 'needs_action'
}

/**
 * @param shipment a shipment from buildModel (with supplier, product, legs and costCad)
 * @param model    the company model
 * @param answers  { delayDays, readiness, readyDate, partialQty, onHandUnits, weeklyDemand, useCompanyDefaultInventory }
 */
export function planDelayResponse(shipment, model, answers = {}, now = Date.now()) {
  const product = shipment.product ?? null
  const supplier = shipment.supplier ?? null
  const operations = model.company.operations ?? {}
  const E = STRATEGY_ASSUMPTIONS.expedited
  const pick = (key, stored) => (key in answers ? answers[key] : stored)

  const delayDays = num(pick('delayDays', shipment.delayDays))
  const readiness = pick('readiness', shipment.readiness) ?? null
  const readyDate = pick('readyDate', shipment.readyDate) || null
  const partialQty = num(pick('partialQty', shipment.partialQty))
  const partialAnswered = 'partialQty' in answers || shipment.partialQty != null
  const onHandUnits = num(pick('onHandUnits', product?.onHandUnits))
  const quantity = num(shipment.quantity)
  const costCad = num(shipment.costCad)
  const dailyShortfall = num(operations.dailyShortfallCost) ?? 0

  // Weekly demand: entered, else stored on the product, else the yearly quantity spread over 52 weeks.
  const enteredDemand = num(pick('weeklyDemand', product?.weeklyDemand))
  const annualQuantity = num(product?.annualQuantity)
  const weeklyDemand = enteredDemand ?? (annualQuantity ? annualQuantity / 52 : null)
  const demandProvenance = enteredDemand != null ? 'actual' : annualQuantity ? 'derived' : 'missing'
  const dailyUnits = weeklyDemand ? weeklyDemand / 7 : null

  // Days of stock for this product. The company-wide figure is used only when the buyer says so.
  const companyDays = model.resolved.bufferDays ?? null
  let coverage
  if (onHandUnits != null && dailyUnits) {
    coverage = { days: round1(onHandUnits / dailyUnits), provenance: 'actual', source: 'On-hand units divided by daily demand' }
  } else if (answers.useCompanyDefaultInventory && companyDays != null) {
    coverage = { days: companyDays, provenance: 'assumption', source: 'Company-wide days of stock, applied to this product' }
  } else {
    coverage = { days: null, range: [0, companyDays ?? 0], provenance: 'missing', source: 'Units on hand for this product are not recorded' }
  }

  // While goods are still being made, the real delay runs until they are finished and then shipped.
  const cautious = readiness === 'in_production' || readiness === 'unknown'
  let effectiveDelay = delayDays
  if (delayDays != null && cautious && readyDate) {
    const untilReady = Math.max(0, Math.ceil((Date.parse(readyDate) - now) / DAY_MS))
    const transit = shipment.legs?.length ? estimateTransitDays(shipment.legs) : 0
    if (Number.isFinite(untilReady)) effectiveDelay = Math.max(delayDays, untilReady + transit)
  }

  const mainLeg = shipment.legs?.find((l) => l.mode === shipment.mode) ?? null
  const mainKm = shipment.legs?.filter((l) => l.mode === shipment.mode).reduce((sum, l) => sum + l.distanceKm, 0) ?? 0
  const unitWeightKg = quantity && num(shipment.weightKg) ? shipment.weightKg / quantity : null
  const alreadyAir = shipment.mode === 'air'

  // The existing engine supplies its assumptions and, when shipment figures are missing, a yearly estimate.
  let scenario = null
  if (supplier && effectiveDelay != null) {
    const scoped = { ...model, resolved: { ...model.resolved, bufferDays: coverage.days ?? companyDays } }
    scenario = runScenario({ type: 'supplier_delay', params: { supplierId: supplier.id, delayDays: effectiveDelay } }, scoped)
  }
  const annualExpedite = scenario?.strategies.find((s) => s.id === 'expedited')?.components.response ?? null
  const shipmentCostKnown = costCad != null && quantity > 0

  /** Cost, remaining gap and emissions of flying `units` of this shipment, against a gap of `gapDays`. */
  const fly = (units, gapDays) => {
    const covered = dailyUnits ? units / dailyUnits : 0
    return {
      units: Math.round(units),
      extraCostCad: shipmentCostKnown ? Math.round(costCad * (units / quantity) * (E.costMultiplier - 1)) : null,
      uncoveredDays: round1(Math.max(0, gapDays - covered)),
      co2eChangeKg: unitWeightKg && mainKm ? Math.round(((units * unitWeightKg) / 1000) * mainKm * (FALLBACK_FACTORS.air - (FALLBACK_FACTORS[shipment.mode] ?? 0))) : null,
    }
  }

  const optionsFor = (gapDays) => {
    const gap = Math.max(0, gapDays)
    const stockout = (days) => (dailyShortfall ? Math.round(days * dailyShortfall) : null)
    const wait = { id: 'wait', feasible: true, feasibilityNote: null, extraCostCad: 0, costBasis: 'shipment', uncoveredDays: round1(gap), co2eChangeKg: 0, units: null }

    if (cautious) {
      const list = [
        { id: 'chase_production', feasible: true, feasibilityNote: null, extraCostCad: 0, costBasis: 'shipment', uncoveredDays: round1(gap), co2eChangeKg: 0, units: null },
        wait,
      ]
      if (partialQty > 0 && quantity && dailyUnits && !alreadyAir) {
        list.push({ id: 'split_shipment', feasible: true, feasibilityNote: 'Only the quantity the supplier says is finished.', costBasis: 'shipment', ...fly(Math.min(partialQty, quantity, gap * dailyUnits || partialQty), gap) })
      } else {
        list.push({ id: 'expedite_partial', feasible: false, feasibilityNote: 'Not available now: the goods are not finished, so faster shipping cannot help yet.', extraCostCad: null, costBasis: 'shipment', uncoveredDays: round1(gap), co2eChangeKg: null, units: null })
      }
      list.push({ id: 'alternative', feasible: false, feasibilityNote: `Not suitable this time: qualifying a new supplier takes about ${STRATEGY_ASSUMPTIONS.alternative.qualificationWeeks} weeks, too slow to help with a disruption that is already under way.`, extraCostCad: null, costBasis: 'shipment', uncoveredDays: round1(gap), co2eChangeKg: null, units: null })
      return list.map((o) => ({ ...o, stockoutCostCad: stockout(o.uncoveredDays) }))
    }

    const list = []
    if (alreadyAir) {
      list.push({ id: 'expedite_partial', feasible: false, feasibilityNote: 'This shipment already travels by air.', extraCostCad: null, costBasis: 'shipment', uncoveredDays: round1(gap), co2eChangeKg: null, units: null })
    } else if (gap > 0 && quantity && dailyUnits) {
      const need = Math.min(quantity, gap * dailyUnits)
      const limited = partialQty != null && partialQty < need
      const part = fly(limited ? partialQty : need, gap)
      list.push({
        id: 'expedite_partial',
        feasible: (limited ? partialQty : need) > 0,
        feasibilityNote: limited ? 'The supplier can release fewer units than the gap needs.' : null,
        costBasis: shipmentCostKnown ? 'shipment' : 'annual_estimate',
        ...part,
        extraCostCad: shipmentCostKnown ? part.extraCostCad : annualExpedite != null ? Math.round(annualExpedite) : null,
      })
      const all = fly(quantity, gap)
      list.push({ id: 'expedite_full', feasible: true, feasibilityNote: null, costBasis: 'shipment', ...all, uncoveredDays: 0 })
    } else if (gap > 0) {
      // Without a quantity or a demand figure, only the engine's yearly estimate is available.
      list.push({ id: 'expedite_partial', feasible: annualExpedite != null, feasibilityNote: 'Shipment quantity or demand is missing, so this is a yearly estimate, not a cost for this shipment.', extraCostCad: annualExpedite != null ? Math.round(annualExpedite) : null, costBasis: 'annual_estimate', uncoveredDays: 0, co2eChangeKg: null, units: null })
    }
    list.push(wait)
    return list.map((o) => ({ ...o, stockoutCostCad: stockout(o.uncoveredDays) }))
  }

  /** The cheapest feasible option that closes the gap. If none does, the one leaving the fewest days. With no gap, wait. */
  const choose = (options, gapDays) => {
    if (cautious) return 'chase_production'
    if (gapDays <= 0) return 'wait'
    const feasible = options.filter((o) => o.feasible)
    const closing = feasible.filter((o) => o.uncoveredDays === 0 && o.extraCostCad != null)
    if (closing.length) return closing.reduce((a, b) => (b.extraCostCad < a.extraCostCad ? b : a)).id
    return feasible.reduce((a, b) => (b.uncoveredDays < a.uncoveredDays ? b : a)).id
  }

  let branch = null
  let options = []
  let recommendedId = null
  let uncoveredDays = null
  if (delayDays != null && readiness) {
    if (coverage.days == null) {
      branch = 'inventory_unknown'
      const low = Math.max(0, effectiveDelay - coverage.range[1])
      const high = effectiveDelay
      uncoveredDays = [low, high]
      const atDefault = optionsFor(low)
      options = optionsFor(high).map((o) => ({ ...o, range: { best: atDefault.find((x) => x.id === o.id) ?? null, worst: o } }))
    } else {
      branch = cautious ? 'in_production' : 'ready'
      uncoveredDays = Math.max(0, round1(effectiveDelay - coverage.days))
      options = optionsFor(uncoveredDays)
      recommendedId = choose(options, uncoveredDays)
    }
  }
  options = options.map((o) => ({ ...o, name: OPTION_NAMES[o.id] }))

  const missing = []
  if (delayDays == null) missing.push('How many days late the shipment is')
  if (!readiness) missing.push('Whether the goods are ready')
  if (onHandUnits == null) missing.push('Units on hand for this product')
  if (cautious && !readyDate) missing.push('The date the goods will be ready')
  if (quantity == null) missing.push('Shipment quantity')
  if (costCad == null) missing.push('Freight cost for this shipment')
  if (weeklyDemand == null) missing.push('Weekly demand for this product')

  let nextQuestion = null
  if (delayDays == null) nextQuestion = 'delayDays'
  else if (!readiness) nextQuestion = 'readiness'
  else if (coverage.days == null) nextQuestion = 'inventory'
  else if (readiness === 'ready' && uncoveredDays > 0 && !partialAnswered) nextQuestion = 'partialQty'

  const approveBlockedReason =
    delayDays == null || !readiness ? 'Confirm the delay and the status of the goods first.'
    : branch === 'inventory_unknown' ? 'Enter inventory, or choose to continue with the company default.'
    : null

  const first = shipment.legs?.[0]?.from?.name
  const last = shipment.legs?.[shipment.legs.length - 1]?.to?.name
  const fact = (key, label, value, provenance, source) => ({ key, label, value, provenance: value == null ? 'missing' : provenance, source })
  const delaySource = (pick('delaySource', shipment.delaySource) ?? 'manual') === 'supplier_email' ? 'Supplier email, confirmed by you' : 'Entered by you'
  const facts = [
    fact('reference', 'Shipment', shipment.reference, 'actual', 'Shipment record'),
    fact('supplier', 'Supplier', supplier?.name ?? null, 'actual', 'Shipment record'),
    fact('product', 'Product', product?.name ?? null, 'actual', 'Shipment record'),
    fact('quantity', 'Quantity', quantity, 'actual', 'Shipment record'),
    fact('route', 'Route', first && last ? `${first} to ${last}` : null, 'derived', 'Built from the shipment hubs'),
    fact('mode', 'Transport mode', shipment.mode ?? null, 'actual', 'Shipment record'),
    fact('eta', 'Recorded ETA', shipment.eta ?? null, 'actual', 'Shipment record'),
    fact('costCad', 'Freight cost', costCad, 'actual', 'Shipment record'),
    fact('delayDays', 'New delay (days)', delayDays, 'actual', delaySource),
    fact('readiness', 'Goods status', readiness ? READINESS_LABELS[readiness] : null, readiness === 'unknown' ? 'assumption' : 'actual', readiness === 'unknown' ? 'Not confirmed, so the cautious case is used' : delaySource),
    fact('readyDate', 'Ready date', readyDate, 'actual', delaySource),
    fact('partialQty', 'Can release now', partialQty, 'actual', delaySource),
    fact('weeklyDemand', 'Weekly demand', weeklyDemand == null ? null : Math.round(weeklyDemand), demandProvenance, demandProvenance === 'derived' ? `Yearly quantity ${annualQuantity.toLocaleString('en-CA')} divided by 52` : 'Entered for this product'),
    fact('onHandUnits', 'Units on hand', onHandUnits, 'actual', 'Entered for this product'),
    fact('coverageDays', 'Days of stock', coverage.days, coverage.provenance, coverage.source),
    fact('dailyShortfallCost', 'Cost per day out of stock', dailyShortfall || null, 'assumption', 'Company setting'),
  ]

  const assumptions = []
  if (!alreadyAir) assumptions.push({ text: `Air freight is assumed to cost ${E.costMultiplier} times this shipment's recorded freight per unit.`, source: 'Planning assumption' })
  if (coverage.provenance === 'assumption') assumptions.push({ text: `Days of stock uses the company-wide figure of ${companyDays} days, not a count for this product.`, source: 'Your choice' })
  if (branch === 'inventory_unknown') assumptions.push({ text: `Stock for this product is unknown, so the gap could be anywhere from ${uncoveredDays?.[0] ?? 0} to ${uncoveredDays?.[1] ?? 0} days.`, source: 'Missing input' })
  if (demandProvenance === 'derived') assumptions.push({ text: 'Weekly demand is the yearly quantity spread evenly over 52 weeks.', source: 'Derived from records' })
  if (readiness === 'unknown') assumptions.push({ text: 'Goods status is not confirmed, so the most cautious case (still in production) is used.', source: 'Your answer' })
  if (dailyShortfall) assumptions.push({ text: `Each day out of stock is costed at the company setting of $${dailyShortfall.toLocaleString('en-CA')}.`, source: 'Company setting' })
  else assumptions.push({ text: 'No cost per day out of stock is set, so days without stock are not costed.', source: 'Company setting' })
  if (options.some((o) => o.co2eChangeKg)) assumptions.push({ text: 'Emissions changes use Waymark transport factors on estimated route distances, for comparison only.', source: 'Waymark estimate' })
  if (options.some((o) => o.costBasis === 'annual_estimate')) assumptions.push({ text: 'A cost marked "Annual estimate" comes from the twelve-month scenario engine, not from this shipment.', source: 'Waymark method' })
  if (cautious && effectiveDelay !== delayDays) assumptions.push({ text: `Effective delay is ${effectiveDelay} days: the wait until the ready date plus estimated transit.`, source: 'Derived from records' })

  return {
    shipmentId: shipment.id,
    inputs: { delayDays, readiness, readyDate, partialQty, onHandUnits, weeklyDemand, quantity, costCad, dailyShortfall, mainLegName: mainLeg ? `${mainLeg.from?.name} to ${mainLeg.to?.name}` : null },
    effectiveDelay,
    facts,
    missing,
    nextQuestion,
    branch,
    coverage,
    uncoveredDays,
    options,
    recommendedId,
    approveBlockedReason,
    assumptions,
    engineAssumptions: scenario?.assumptions ?? [],
  }
}
