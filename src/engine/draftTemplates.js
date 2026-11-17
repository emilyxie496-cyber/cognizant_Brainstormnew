/*
  Fixed message templates for Delay Assist. They are used when no AI provider is
  set up, when it fails, or when its draft contains a figure that cannot be
  checked. Every number is filled straight from the plan, so nothing is invented.
*/
import { OPTION_NAMES, READINESS_LABELS } from './delayPlan.js'

const n = (value) => Number(value).toLocaleString('en-CA')
const cad = (value) => `$${n(Math.round(value))}`

/** The facts both the AI and the templates write from. Only computed or confirmed values go in. */
export function draftFacts(plan, option, shipment, company) {
  const { inputs } = plan
  const other = plan.options.filter((o) => o.id !== option.id)
  const toConfirm = ['the revised ship date']
  if (inputs.readiness !== 'ready') toConfirm.push('the date the goods will be finished')
  if (option.units) toConfirm.push(`that ${n(option.units)} units can ship by air now`)
  if (inputs.partialQty == null) toConfirm.push('how many units, if any, can be released early')
  return {
    company: company?.name ?? null,
    shipment: shipment.reference,
    supplier: shipment.supplier?.name ?? null,
    product: shipment.product?.name ?? null,
    quantity: inputs.quantity,
    recordedEta: shipment.eta ?? null,
    delayDays: inputs.delayDays,
    goodsStatus: inputs.readiness ? READINESS_LABELS[inputs.readiness] : null,
    readyDate: inputs.readyDate,
    daysOfStock: plan.coverage.days,
    daysOfStockSource: plan.coverage.source,
    daysWithoutStock: plan.uncoveredDays,
    chosen: {
      name: OPTION_NAMES[option.id],
      units: option.units,
      extraCostCad: option.extraCostCad,
      costBasis: option.costBasis === 'annual_estimate' ? 'annual estimate' : 'per this shipment',
      daysWithoutStockAfter: option.uncoveredDays,
      stockoutCostCad: option.stockoutCostCad,
    },
    notChosen: other.map((o) => ({ name: OPTION_NAMES[o.id], extraCostCad: o.extraCostCad, daysWithoutStock: o.uncoveredDays, available: o.feasible })),
    assumptions: plan.assumptions.map((a) => a.text),
    stillUnknown: plan.missing,
    toConfirm,
  }
}

export function supplierDraft(f) {
  const lines = [
    `Hello ${f.supplier ?? 'team'},`,
    '',
    `Thank you for the update on ${f.shipment}${f.product ? ` (${n(f.quantity ?? 0)} units of ${f.product})` : ''}. We understand it is now expected about ${n(f.delayDays)} days late.`,
    '',
  ]
  if (f.chosen.units) lines.push(`To protect our stock, we would like to ship ${n(f.chosen.units)} units by air as soon as possible and keep the rest on the original booking.`, '')
  else if (f.chosen.name === OPTION_NAMES.chase_production) lines.push('Before we change the shipping plan, we need a firm date for when the goods will be finished.', '')
  else lines.push('We plan to keep the shipment on its current booking.', '')
  lines.push('Please confirm:')
  f.toConfirm.forEach((item) => lines.push(`- ${item}`))
  lines.push('', 'Please reply with confirmed dates and quantities so we can update our plan.', '', 'Thank you,', f.company ?? '')
  return lines.join('\n').trim()
}

export function managerDraft(f) {
  const cost = f.chosen.extraCostCad == null ? 'cost not available' : `${cad(f.chosen.extraCostCad)} extra freight (${f.chosen.costBasis}, estimate)`
  const lines = [
    `Decision summary: ${f.shipment}`,
    '',
    `Situation: ${f.shipment} from ${f.supplier ?? 'the supplier'} is about ${n(f.delayDays)} days late. Goods status: ${f.goodsStatus ?? 'not confirmed'}.`,
    f.daysOfStock == null
      ? 'Days of stock for this product are not recorded.'
      : `Days of stock: ${n(f.daysOfStock)} (${f.daysOfStockSource}). Days without stock if nothing changes: ${Array.isArray(f.daysWithoutStock) ? `${n(f.daysWithoutStock[0])} to ${n(f.daysWithoutStock[1])}` : n(f.daysWithoutStock ?? 0)}.`,
    '',
    `Chosen: ${f.chosen.name}. ${cost}. Days without stock afterwards: ${n(f.chosen.daysWithoutStockAfter ?? 0)}.`,
    '',
    'Not chosen:',
    ...f.notChosen.map((o) => `- ${o.name}: ${!o.available ? 'not available now' : `${o.extraCostCad == null ? 'cost not available' : `${cad(o.extraCostCad)} extra`}, ${n(o.daysWithoutStock ?? 0)} days without stock`}`),
    '',
    'Assumptions:',
    ...f.assumptions.map((a) => `- ${a}`),
  ]
  if (f.stillUnknown.length) lines.push('', 'Still unknown:', ...f.stillUnknown.map((m) => `- ${m}`))
  return lines.join('\n').trim()
}

export const templateDraft = (audience, facts) => (audience === 'supplier' ? supplierDraft(facts) : managerDraft(facts))
