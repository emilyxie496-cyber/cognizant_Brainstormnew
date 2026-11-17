/*
  Joins records synced from business systems (accounting, commerce, CRM) to the
  company's Waymark model. Pure functions, shared by the pages and the agent's
  tools, so both always show the same figures.

  Two rules run through all of it:
  - Imported records are facts from the source system and are labelled as such.
    Anything Waymark works out from them is labelled derived.
  - A link between an external record and a Waymark product or supplier exists
    only when the user mapped it, or when two names are identical. Nothing is
    linked by guesswork, and an unlinked record is reported as unlinked.
*/

const norm = (text) => String(text ?? '').toLowerCase().replace(/&/g, 'and').replace(/\b(inc|ltd|llc|co|corp|corporation|company|limited)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0)

const mappingFor = (mappings, provider, kind, externalId) =>
  (mappings ?? []).find((m) => m.provider === provider && m.kind === kind && String(m.externalId) === String(externalId)) ?? null

/** A shipment that deserves attention: recorded as delayed, or flagged high route risk by the model. */
export const shipmentAtRisk = (s) => s.active && (s.status === 'delayed' || s.risk?.level === 'high')

/** Active inbound shipments carrying a Waymark product. */
function inboundFor(model, productId) {
  return model.shipments
    .filter((s) => s.active && s.direction !== 'export' && s.productId === productId)
    .map((s) => ({ id: s.id, reference: s.reference, status: s.status, eta: s.eta ?? null, delayed: s.status === 'delayed', atRisk: shipmentAtRisk(s), supplier: s.supplier?.name ?? null }))
}

/* ---------- Accounting ---------- */

export function financialIntelligence(finance, mappings, model) {
  if (!finance) return null
  const allDocs = [...(finance.bills ?? []).map((b) => ({ ...b, kind: 'bill' })), ...(finance.purchases ?? []).map((p) => ({ ...p, kind: 'purchase' }))]
  const docs = allDocs.filter(d => !d.currency || d.currency === (finance.currency ?? 'CAD'))
  const byVendor = new Map()
  for (const d of docs) {
    const key = d.vendorId ?? `name:${d.vendorName ?? 'Unassigned'}`
    const row = byVendor.get(key) ?? { vendorId: d.vendorId ?? null, name: d.vendorName ?? 'Unassigned', total: 0, documents: 0, lastDate: null }
    row.total += Number(d.total) || 0
    row.documents += 1
    if (d.date && (!row.lastDate || d.date > row.lastDate)) row.lastDate = d.date
    byVendor.set(key, row)
  }
  // Vendors with no transactions still appear, so a supplier with no bills is visible as such.
  for (const v of finance.vendors ?? []) {
    if (!byVendor.has(v.externalId)) byVendor.set(v.externalId, { vendorId: v.externalId, name: v.name, total: 0, documents: 0, lastDate: null })
  }

  const suppliers = model?.suppliers ?? []
  const vendors = [...byVendor.values()]
    .map((v) => {
      const mapped = v.vendorId ? mappingFor(mappings, 'quickbooks', 'vendor', v.vendorId) : null
      const supplier = mapped ? suppliers.find((s) => s.id === mapped.waymarkId) : suppliers.find((s) => norm(s.name) && norm(s.name) === norm(v.name))
      const recorded = supplier?.spendCad || null
      return {
        ...v,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? null,
        link: mapped && supplier ? 'mapped' : supplier ? 'name' : 'none',
        recordedAnnualSpendCad: recorded,
        // Only comparable when the books are in CAD: currencies are never mixed.
        variancePct: recorded && v.total && (finance.currency ?? 'CAD') === 'CAD' ? (v.total - recorded) / recorded : null,
      }
    })
    .sort((a, b) => b.total - a.total)

  const months = new Map()
  for (const d of docs) {
    const month = String(d.date ?? '').slice(0, 7)
    if (month.length === 7) months.set(month, (months.get(month) ?? 0) + (Number(d.total) || 0))
  }
  const trend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total }))

  const byAccount = new Map()
  for (const d of docs) for (const line of d.lines ?? []) byAccount.set(line.account ?? 'Uncategorised', (byAccount.get(line.account ?? 'Uncategorised') ?? 0) + (Number(line.amount) || 0))

  const totalSpend = sum(docs, (d) => d.total)
  return {
    currency: finance.currency ?? 'CAD',
    asOf: finance.asOf ?? null,
    demo: Boolean(finance.demo),
    source: finance.source ?? 'QuickBooks Online',
    totalSpend,
    outstandingPayables: sum(docs.filter(d => d.kind === 'bill'), (b) => b.balance),
    documentCount: docs.length,
    vendors,
    linkedVendors: vendors.filter((v) => v.link !== 'none').length,
    // A trend needs at least three months to mean anything.
    trend: trend.length >= 3 ? trend : [],
    categories: [...byAccount.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8),
    budgets: finance.budgets ?? [],
    topVendorShare: totalSpend ? (vendors[0]?.total ?? 0) / totalSpend : 0,
    notes: [
      ...(docs.length !== allDocs.length ? [`${allDocs.length - docs.length} foreign-currency documents are excluded from these totals; currencies are not combined without conversion.`] : []),
      'Totals are bills and purchases recorded in the accounting system for the synced period. They are accounting facts, not forecasts.',
      'Accounting records do not show inventory on hand or an approved purchasing budget unless a budget is listed below.',
    ],
  }
}

/* ---------- Commerce ---------- */

const OPEN_FULFILLMENT = new Set(['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'ON_HOLD', 'SCHEDULED', 'OPEN'])
const isOpenOrder = (o) => !o.cancelled && OPEN_FULFILLMENT.has(String(o.fulfillmentStatus ?? '').toUpperCase())

export function inventoryRisk(commerce, mappings, model) {
  if (!commerce) return null
  const openOrders = (commerce.orders ?? []).filter(isOpenOrder)
  const demand = new Map()
  for (const o of openOrders) for (const line of o.lines ?? []) {
    const key = line.variantId ?? line.sku ?? line.title
    demand.set(key, (demand.get(key) ?? 0) + (Number(line.quantity) || 0))
  }

  const rows = []
  for (const p of commerce.products ?? []) {
    const mapped = mappingFor(mappings, 'shopify', 'product', p.externalId)
    const product = mapped ? model.products.find((x) => x.id === mapped.waymarkId) ?? null : null
    const inbound = product ? inboundFor(model, product.id) : []
    for (const v of p.variants ?? []) {
      const onHand = v.inventoryQuantity == null ? null : Number(v.inventoryQuantity)
      const openDemand = demand.get(v.externalId) ?? demand.get(v.sku) ?? 0
      const net = onHand == null ? null : onHand - openDemand
      const level = onHand == null ? 'unknown' : onHand <= 0 && openDemand > 0 ? 'stockout' : net < 0 ? 'short' : openDemand > 0 && net < openDemand ? 'low' : 'ok'
      rows.push({
        productId: p.externalId,
        variantId: v.externalId,
        title: v.title && v.title !== 'Default Title' ? `${p.title} (${v.title})` : p.title,
        sku: v.sku || null,
        onHand,
        openDemand,
        net,
        level,
        waymarkProductId: product?.id ?? null,
        waymarkProductName: product?.name ?? null,
        inbound,
        // Supply risk is only stated where a mapping makes the dependency real.
        supplyRisk: !product ? 'unlinked' : inbound.some((s) => s.atRisk) ? 'delayed_supply' : inbound.length ? 'supply_on_schedule' : 'no_inbound',
      })
    }
  }
  const rank = { stockout: 0, short: 1, low: 2, unknown: 3, ok: 4 }
  rows.sort((a, b) => rank[a.level] - rank[b.level] || (a.net ?? 0) - (b.net ?? 0))

  const byVariant = new Map(rows.map((r) => [r.variantId, r]))
  const bySku = new Map(rows.filter((r) => r.sku).map((r) => [r.sku, r]))
  const affectedOrders = openOrders
    .map((o) => {
      const lines = (o.lines ?? []).map((l) => ({ ...l, row: byVariant.get(l.variantId) ?? bySku.get(l.sku) ?? null }))
      const exposed = lines.filter((l) => l.row && l.row.supplyRisk === 'delayed_supply' && l.row.level !== 'ok')
      const short = lines.filter((l) => l.row && (l.row.level === 'stockout' || l.row.level === 'short'))
      return {
        externalId: o.externalId,
        name: o.name,
        createdAt: o.createdAt ?? null,
        fulfillmentStatus: o.fulfillmentStatus ?? null,
        lineCount: lines.length,
        status: exposed.length ? 'potentially_affected' : short.length ? 'short_stock' : 'ok',
        reasons: [
          ...exposed.map((l) => `${l.row.title}: ${l.row.onHand} on hand, and ${l.row.inbound.filter((s) => s.atRisk).map((s) => s.reference).join(', ')} is delayed or at risk`),
          ...short.filter((l) => !exposed.includes(l)).map((l) => `${l.row.title}: ${l.row.onHand} on hand against ${l.row.openDemand} on open orders${l.row.supplyRisk === 'unlinked' ? ' (no shipment linked)' : ''}`),
        ],
        shipments: [...new Set(exposed.flatMap((l) => l.row.inbound.filter((s) => s.atRisk).map((s) => s.reference)))],
      }
    })
    .filter((o) => o.status !== 'ok')

  return {
    asOf: commerce.asOf ?? null,
    demo: Boolean(commerce.demo),
    source: commerce.source ?? 'Shopify',
    shop: commerce.shop ?? null,
    rows,
    openOrderCount: openOrders.length,
    affectedOrders,
    counts: {
      stockout: rows.filter((r) => r.level === 'stockout').length,
      short: rows.filter((r) => r.level === 'short').length,
      low: rows.filter((r) => r.level === 'low').length,
      unlinked: (commerce.products ?? []).filter((p) => !mappingFor(mappings, 'shopify', 'product', p.externalId)).length,
      products: (commerce.products ?? []).length,
    },
    locations: commerce.locations ?? [],
    notes: ['Inventory and orders are as reported by the store at the sync time shown.', 'A product is tied to a shipment only through a mapping you create.'],
  }
}

/** Shopify products with a Waymark product of the same name, offered as suggestions for the user to confirm. */
export function suggestProductMappings(commerce, mappings, model) {
  return (commerce?.products ?? [])
    .filter((p) => !mappingFor(mappings, 'shopify', 'product', p.externalId))
    .map((p) => {
      const words = new Set(norm(p.title).split(' ').filter((w) => w.length > 3))
      const best = model.products
        .map((x) => ({ product: x, overlap: norm(x.name).split(' ').filter((w) => words.has(w)).length }))
        .sort((a, b) => b.overlap - a.overlap)[0]
      return { externalId: p.externalId, title: p.title, suggestion: best && best.overlap >= 2 ? { id: best.product.id, name: best.product.name } : null }
    })
}

/* ---------- CRM ---------- */

const CLOSED_STAGE = /closed/i
const CLOSED_ORDER = /^(cancel|complete|closed|fulfilled|shipped|delivered)/i

export function customerImpact(crm, mappings, model) {
  if (!crm) return null
  const linkOf = (accountId) => {
    const mapped = mappingFor(mappings, 'salesforce', 'account', accountId)
    const product = mapped ? model.products.find((p) => p.id === mapped.waymarkId) ?? null : null
    const inbound = product ? inboundFor(model, product.id) : []
    return { product, inbound, risky: inbound.filter((s) => s.atRisk) }
  }
  const describe = (link) =>
    !link.product ? { status: 'unlinked', detail: 'No product is mapped to this customer, so exposure cannot be assessed.' }
      : link.risky.length ? { status: 'potentially_affected', detail: `${link.product.name} is supplied by ${link.risky.map((s) => `${s.reference} (${s.status === 'delayed' ? `delayed, ETA ${s.eta ?? 'unknown'}` : 'high route risk'})`).join(', ')}.` }
        : { status: 'no_exposure', detail: link.inbound.length ? `${link.product.name}: inbound shipments are on schedule.` : `${link.product.name}: no active inbound shipment on record.` }

  const orders = (crm.orders ?? []).filter((o) => !CLOSED_ORDER.test(o.status ?? '')).map((o) => {
    const link = linkOf(o.accountId)
    return { type: 'order', externalId: o.externalId, label: o.number ? `Order ${o.number}` : 'Order', customer: o.accountName ?? 'Unknown account', accountId: o.accountId, amount: o.total ?? null, date: o.effectiveDate ?? null, stage: o.status ?? null, ...describe(link), shipments: link.risky.map((s) => s.reference), productName: link.product?.name ?? null }
  })
  const opportunities = (crm.opportunities ?? []).filter((o) => !CLOSED_STAGE.test(o.stage ?? '')).map((o) => {
    const link = linkOf(o.accountId)
    return { type: 'opportunity', externalId: o.externalId, label: o.name, customer: o.accountName ?? 'Unknown account', accountId: o.accountId, amount: o.amount ?? null, date: o.closeDate ?? null, stage: o.stage ?? null, ...describe(link), shipments: link.risky.map((s) => s.reference), productName: link.product?.name ?? null }
  })
  const rank = { potentially_affected: 0, unlinked: 1, no_exposure: 2 }
  const commitments = [...orders, ...opportunities].sort((a, b) => rank[a.status] - rank[b.status] || (b.amount ?? 0) - (a.amount ?? 0))
  const affected = commitments.filter((c) => c.status === 'potentially_affected')

  return {
    asOf: crm.asOf ?? null,
    demo: Boolean(crm.demo),
    source: crm.source ?? 'Salesforce',
    currency: crm.currency ?? null,
    commitments,
    affected,
    affectedValue: sum(affected, (c) => c.amount),
    accounts: (crm.accounts ?? []).map((a) => ({ ...a, mapping: mappingFor(mappings, 'salesforce', 'account', a.externalId) })),
    unavailable: crm.unavailable ?? [],
    notes: [
      'A commitment is "potentially affected" when its customer is mapped to a product whose inbound shipment is delayed or at high route risk. It is not a confirmed late delivery.',
      ...(crm.unavailable?.length ? [`Not available in this Salesforce org: ${crm.unavailable.join(', ')}.`] : []),
    ],
  }
}
