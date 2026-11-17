/*
  The built-in planner: a rule-based way to run an investigation when no AI
  model is configured, and for automated monitoring.

  It reads the task, picks a fixed sequence of tools, runs them through the same
  executor the AI models use (same permissions, limits and audit trail), and
  writes its findings from the tool results with templates. It is labelled
  "Built-in planner" wherever it is used. It never calls an AI provider, so no
  business data leaves Waymark.

  `compose` is also the fallback for a model that runs tools but fails to write
  up its findings.
*/

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
const UNIT_DAYS = { day: 1, week: 7, month: 30 }
const has = (text, ...terms) => terms.some((t) => text.includes(t))
const cad = (n) => (n == null ? 'an unknown amount' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n))

/** "two-week", "10 days", "a month" to a number of days, or null. */
export function parseDelayDays(task) {
  const m = /(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]*(day|week|month)/i.exec(task)
  if (!m) return null
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1].toLowerCase()] ?? 1
  return Math.min(120, Math.max(1, n * UNIT_DAYS[m[2].toLowerCase()]))
}

export function classify(task) {
  const t = task.toLowerCase()
  if (has(t, 'weather', 'storm', 'wind', 'forecast', 'typhoon', 'hurricane')) return 'weather'
  if (has(t, 'customer', 'order', 'commitment', 'account')) return 'customers'
  if (has(t, 'alternative', 'compare', 'replace', 'other supplier', 'switch supplier')) return 'alternatives'
  if (has(t, 'financial', 'cost', 'budget', 'spend') || parseDelayDays(t)) return 'financial'
  if (has(t, 'emission', 'carbon', 'co2', 'sustainab')) return 'emissions'
  if (has(t, 'summary', 'report', 'brief', 'overview')) return 'summary'
  if (has(t, 'news', 'headline', 'strike', 'port', 'event', 'disruption', 'sanction', 'tariff')) return 'news'
  return 'at_risk'
}

const wantsNotification = (t) => has(t.toLowerCase(), 'slack', 'teams', 'notify', 'notification', 'alert my', 'alert the', 'tell my team', 'message my')
const channelOf = (t) => (t.toLowerCase().includes('teams') ? 'teams' : 'slack')

/** A shipment or supplier the task names outright. */
function namedIn(task, model) {
  const t = task.toLowerCase()
  return {
    shipment: model.shipments.find((s) => t.includes(String(s.reference).toLowerCase())) ?? null,
    supplier: model.suppliers.find((s) => t.includes(s.name.toLowerCase())) ?? null,
  }
}

const topSupplier = (model) => [...model.suppliers].sort((a, b) => b.share - a.share)[0] ?? null

/**
 * @param directive optional overrides from the monitor: { intent, shipmentId, draft: ['slack'], category, nextStep }
 */
export async function runPlanner({ task, ctx, exec, directive = {} }) {
  const { model, demoScenario } = ctx
  const intent = directive.intent ?? classify(task)
  const named = namedIn(task, model)
  const call = async (name, input = {}) => (await exec(name, input)).result
  const drafts = directive.draft ?? (wantsNotification(task) ? [channelOf(task)] : [])

  let shipment = directive.shipmentId ? model.shipments.find((s) => s.id === directive.shipmentId) : named.shipment
  const draft = async (category, nextStep) => {
    if (!shipment) return
    for (const channel of drafts) await call(`draft_${channel}_notification`, { shipment: shipment.reference, category: directive.category ?? category, nextStep: directive.nextStep ?? nextStep })
  }

  if (intent === 'weather' || intent === 'at_risk') {
    const list = await call('get_shipments', { filter: intent === 'at_risk' ? 'at_risk' : 'active' })
    const fallback = list?.shipments?.length ? null : await call('get_shipments', { filter: 'active' })
    const first = (list?.shipments?.length ? list : fallback)?.shipments?.[0]
    shipment ??= (intent === 'weather' && demoScenario ? model.shipments.find((s) => s.id === demoScenario.shipmentId) : null) ?? (first ? model.shipments.find((s) => s.id === first.id) : null)
    if (!shipment) return
    const weather = await call('get_weather_risk', { shipment: shipment.reference })
    await call('get_logistics_updates', { shipment: shipment.reference })
    const supplier = shipment.supplier
    const hub = weather?.signals?.length ? shipment.legs.flatMap((l) => [l.from, l.to]).find((p) => p?.code && p.name === weather.signals[0].location)?.code : null
    if (hub) await call('run_risk_simulation', { type: 'severe_weather', hub })
    else if (supplier) await call('run_risk_simulation', { type: 'supplier_delay', supplier: supplier.name, delayDays: 14 })
    if (supplier) await call('compare_supplier_alternatives', { supplier: supplier.name })
    if (demoScenario) {
      await call('get_financial_context')
      await call('get_inventory')
      await call('get_customer_orders')
      await call('generate_report', { type: 'risk' })
    }
    await draft(weather?.signalCount ? 'weather_disruption' : 'high_risk_shipment', 'Review alternative supplier options and confirm status with the carrier.')
    return
  }

  if (intent === 'alternatives') {
    const supplier = named.supplier ?? shipment?.supplier ?? topSupplier(model)
    if (!supplier) return void (await call('get_shipments', { filter: 'active' }))
    const t = task.toLowerCase()
    const priority = has(t, 'cost', 'cheap', 'price') ? 'cost' : has(t, 'fast', 'speed', 'quick') ? 'speed' : has(t, 'emission', 'carbon') ? 'emissions' : has(t, 'local', 'canadian') ? 'local' : 'balanced'
    await call('get_supplier_details', { supplier: supplier.name })
    await call('compare_supplier_alternatives', { supplier: supplier.name, priority })
    await call('calculate_emissions', { supplier: supplier.name })
    await call('run_risk_simulation', { type: 'supplier_delay', supplier: supplier.name })
    shipment ??= model.shipments.find((s) => s.active && s.supplierId === supplier.id) ?? null
    await draft('supplier_alternative', 'Review the ranked alternatives and request a quote.')
    return
  }

  if (intent === 'financial') {
    const supplier = named.supplier ?? shipment?.supplier ?? null
    await call('get_financial_context')
    await call('calculate_financial_impact', { delayDays: parseDelayDays(task) ?? 14, ...(supplier ? { supplier: supplier.name } : {}) })
    await call('get_inventory')
    shipment ??= model.shipments.find((s) => s.active && (!supplier || s.supplierId === supplier.id)) ?? null
    await draft('cost_impact', 'Review the costed responses in the Risk Simulator.')
    return
  }

  if (intent === 'customers') {
    const list = await call('get_shipments', { filter: 'at_risk' })
    await call('get_customer_orders')
    await call('get_inventory')
    shipment ??= list?.shipments?.[0] ? model.shipments.find((s) => s.id === list.shipments[0].id) : null
    await draft('inventory_risk', 'Check the flagged orders and tell the account owners.')
    return
  }

  if (intent === 'emissions') {
    if (shipment) await call('calculate_emissions', { shipment: shipment.reference })
    else if (named.supplier) await call('calculate_emissions', { supplier: named.supplier.name })
    else await call('calculate_emissions')
    return
  }

  if (intent === 'news') {
    const t = task.toLowerCase()
    const category = has(t, 'tariff', 'trade deal') ? 'trade' : has(t, 'sanction', 'restriction') ? 'policy' : has(t, 'port', 'shipping', 'container') ? 'shipping' : 'disruption'
    const news = await call('get_disruption_news', { category })
    const list = await call('get_shipments', { filter: 'at_risk' })
    await call('run_risk_simulation', { type: has(t, 'tariff') ? 'tariff' : has(t, 'port', 'strike') ? 'port_closure' : 'freight_disruption' })
    const ref = news?.headlines?.[0]?.shipments?.[0]?.split(':')[0]
    shipment ??= model.shipments.find((s) => s.reference === ref) ?? (list?.shipments?.[0] ? model.shipments.find((s) => s.id === list.shipments[0].id) : null)
    await draft('high_risk_shipment', 'Review the matched shipments against the reported event.')
    return
  }

  // summary
  const list = await call('get_shipments', { filter: 'active' })
  await call('get_disruption_news', { category: 'disruption' })
  await call('get_financial_context')
  await call('generate_report', { type: 'risk' })
  shipment ??= list?.shipments?.[0] ? model.shipments.find((s) => s.id === list.shipments[0].id) : null
  await draft('investigation_complete', 'Open the risk report in Waymark.')
}

/**
 * Findings written from tool results alone. `results` maps a tool name to its
 * most recent successful result.
 */
export function compose(results) {
  const lines = []
  const recommendations = []
  const uncertainties = []
  const r = results

  const ships = r.get_shipments
  if (ships) {
    const flagged = ships.shipments.filter((s) => s.status === 'delayed' || s.routeRisk === 'high')
    const top = ships.shipments[0]
    if (!ships.shipments.length) lines.push('No shipments match that filter in your records.')
    else {
      lines.push(`${ships.count} of your ${ships.totalShipments} shipments were reviewed, and ${flagged.length} ${flagged.length === 1 ? 'is' : 'are'} delayed or at high route risk.`)
      if (top) lines.push(`The one most in need of attention is ${top.reference}${top.supplier ? ` from ${top.supplier}` : ''}: status ${top.status.replace('_', ' ')}, ETA ${top.eta ?? 'unknown'}, ${top.routeRisk} route risk${top.riskReasons.length ? ` (${top.riskReasons.join('; ').toLowerCase()})` : ''}.`)
    }
  }

  const wx = r.get_weather_risk
  if (wx) {
    if (wx.available === false) uncertainties.push(`${wx.shipment}: no route coordinates, so weather could not be checked.`)
    else if (wx.signalCount) {
      const s = wx.signals[0]
      lines.push(`The forecast for ${wx.shipment} shows ${s.signal.toLowerCase()} near ${s.location} on ${s.date}${s.simulated ? ' (a simulated demo forecast, not a live reading)' : ''}. This is possible exposure to review, not a confirmed delay.`)
      recommendations.push({ title: `Confirm ${wx.shipment} with the carrier`, detail: `Ask whether the forecast near ${s.location} on ${s.date} changes the schedule.`, priority: 'high' })
    } else if (wx.locationsChecked) lines.push(`No severe weather is forecast over the next three days at the ${wx.locationsChecked} route points checked for ${wx.shipment}.`)
    if (wx.locationsUnavailable) uncertainties.push(`Weather for ${wx.locationsUnavailable} route point(s) of ${wx.shipment} could not be checked because the weather service did not respond.`)
  }

  const track = r.get_logistics_updates
  if (track) {
    if (track.tracking) lines.push(`${track.tracking.sampleData ? 'Sample tracking' : 'Tracking'} from ${track.tracking.provider} reports ${track.shipment} as "${track.tracking.status}"${track.tracking.lastLocation ? `, last at ${track.tracking.lastLocation.name}` : ''}${track.tracking.delaySignal ? `. ${track.tracking.delaySignal}` : '.'}`)
    else uncertainties.push(`${track.shipment} has no live tracking: ${track.trackingUnavailableReason}`)
  }

  const sim = r.calculate_financial_impact ?? r.run_risk_simulation
  if (sim && !sim.error) {
    lines.push(`Waymark's simulator, for "${sim.scenario}", estimates ${cad(sim.totalAddedCostCad)} of added cost over 12 months (${sim.shareOfBaselinePct}% of the baseline), with ${sim.inventoryShortfallDays} days not covered by stock and ${sim.affectedShipments} active shipment(s) on the affected lanes.`)
    if (!sim.totalAddedCostCad && !sim.inventoryShortfallDays) lines.push('On these inputs, current stock cover absorbs a disruption of this size.')
    else if (sim.lowestCostResponse) {
      lines.push(`Of the responses compared, "${sim.lowestCostResponse}" has the lowest added cost. Lowest cost is not automatically the best choice.`)
      recommendations.push({ title: `Review the "${sim.lowestCostResponse}" response`, detail: 'Open the Risk Simulator to adjust the assumptions and compare every response side by side.', priority: 'medium' })
    }
    if (sim.shortageCosted === false) uncertainties.push('No daily shortfall cost is entered, so days without stock are counted but not costed.')
  }

  const alt = r.compare_supplier_alternatives
  if (alt) {
    const c = alt.comparisons?.[0]
    if (!c) uncertainties.push(alt.message ?? 'No alternative supplier leads are saved, so there is nothing to compare.')
    else {
      lines.push(c.recommendedIsCurrent ? `For ${c.product}, the recommendation engine still ranks the current supplier, ${c.currentSupplier}, first under a ${alt.priority} priority.` : `For ${c.product}, the recommendation engine ranks ${c.recommended} above the current supplier, ${c.currentSupplier}, under a ${alt.priority} priority.`)
      lines.push(...c.explanation.slice(1, 4))
      if (!c.recommendedIsCurrent) recommendations.push({ title: `Request a quote from ${c.recommended}`, detail: 'Confirm price, lead time and documentation before changing any sourcing.', priority: 'medium' })
      const unknown = c.ranked[0]?.unknown ?? []
      if (unknown.length) uncertainties.push(`Not known for ${c.ranked[0].name}: ${unknown.join(', ').toLowerCase()}.`)
    }
  }

  const sup = r.get_supplier_details
  if (sup && !sup.error) lines.push(`${sup.name} (${sup.country}) carries ${sup.sharePct}% of sourcing, with a ${sup.leadTimeDays ?? 'unrecorded'}-day lead time and ${sup.documentation.verified} of ${sup.documentation.of} responsible-sourcing records verified.`)

  const fin = r.get_financial_context
  if (fin) {
    lines.push(`Annual import spending is ${cad(fin.annualImportSpendCad)} (${fin.importSpendBasis}) and freight spending is ${cad(fin.annualFreightSpendCad)} (${fin.freightSpendBasis}).`)
    if (fin.accounting) lines.push(`${fin.accounting.sampleData ? 'Sample accounting data' : fin.accounting.source} shows ${cad(fin.accounting.recordedSpend)} of recorded vendor spend, the largest being ${fin.accounting.vendors[0]?.vendor ?? 'unknown'}.`)
    else uncertainties.push('No accounting system is connected, so spend figures are the ones entered in Waymark.')
  }

  const inv = r.get_inventory
  if (inv) {
    if (inv.store) {
      const n = inv.store.counts.stockout + inv.store.counts.short
      lines.push(`${inv.store.sampleData ? 'Sample store data' : inv.store.source} shows ${n} product(s) short of open orders across ${inv.store.openOrders} open orders.`)
      if (inv.store.atRisk[0]) recommendations.push({ title: `Check stock for ${inv.store.atRisk[0].product}`, detail: `${inv.store.atRisk[0].onHand} on hand against ${inv.store.atRisk[0].onOpenOrders} on open orders.`, priority: 'high' })
    } else lines.push(`Stock cover is ${inv.stockCoverDays ?? 'not entered'} days against a ${inv.leadTimeDays}-day lead time.`)
  }

  const cust = r.get_customer_orders
  if (cust) {
    if (cust.available === false) uncertainties.push(cust.message)
    else {
      if (cust.crm) {
        lines.push(`${cust.crm.sampleData ? 'Sample CRM data' : cust.crm.source} lists ${cust.crm.potentiallyAffected} customer commitment(s) that a delayed or high-risk shipment could reach${cust.crm.potentiallyAffected ? `, worth ${cad(cust.crm.potentiallyAffectedValue)}` : ''}.`)
        if (cust.crm.potentiallyAffected) recommendations.push({ title: 'Tell the account owners', detail: `${cust.crm.potentiallyAffected} commitment(s) depend on a shipment that is delayed or at high route risk.`, priority: 'high' })
      }
      if (cust.storeOrders?.flagged.length) lines.push(`${cust.storeOrders.flagged.length} open store order(s) are short of stock or depend on delayed supply.`)
    }
  }

  const news = r.get_disruption_news
  if (news) {
    if (news.available === false) uncertainties.push(news.message)
    else lines.push(news.matchedToRecords ? `${news.matchedToRecords} of ${news.headlinesRead} current headlines name a place your suppliers or active shipments use. These are reports of possible exposure, not confirmed effects.` : `None of the ${news.headlinesRead} current headlines read names a place your suppliers or active shipments use.`)
  }

  const em = r.calculate_emissions
  if (em && em.available !== false && !em.error) lines.push(em.shipment ? `${em.shipment} is estimated at ${em.co2eKg} kg CO2e of transport emissions (${em.method}).` : em.supplier ? `${em.supplier}'s lane is estimated at ${em.annualCo2eKg} kg CO2e a year (${em.method}).` : `Recorded shipments total ${em.totalCo2eKg} kg CO2e of transport emissions (${em.method}).`)

  const report = r.generate_report
  if (report && !report.error) {
    lines.push(`A report, "${report.title}", has been built from your records and is attached to this investigation.`)
    recommendations.push({ title: 'Share the report', detail: 'Save it to Reports to export it as PDF or CSV.', priority: 'low' })
  }

  const draft = r.draft_slack_notification ?? r.draft_teams_notification
  if (draft && !draft.error) {
    lines.push(draft.status === 'pending' ? 'A notification has been drafted and is waiting for your approval. Nothing has been sent.' : `The drafted notification is ${draft.status.replace('_', ' ')}.`)
    if (draft.status === 'pending') recommendations.push({ title: 'Approve or reject the drafted message', detail: draft.channelConnected ? 'It will be posted only after you approve it.' : 'The channel is not connected, so approving it will not send anything yet.', priority: 'medium' })
  }

  for (const result of Object.values(r)) {
    if (result?.error) uncertainties.push(result.message)
    for (const note of result?.notes ?? []) if (/sample data|simulated/i.test(note) && !uncertainties.includes(note)) uncertainties.push(note)
  }
  if (!lines.length) lines.push('The investigation ran, but the tools returned nothing that could be summarised. Add suppliers and shipments, or connect a data source, and try again.')
  return { summary: lines.join('\n\n'), recommendations: recommendations.slice(0, 6), uncertainties: [...new Set(uncertainties)].slice(0, 8) }
}
