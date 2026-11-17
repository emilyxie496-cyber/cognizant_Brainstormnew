/*
  Demo Mode fixtures. Deterministic sample records that stand in for a business
  system when the user chooses "Use sample data". Every dataset built here is
  flagged `demo: true`, the connection reports "Demo Mode" rather than
  "Connected", and the pages label the figures as sample data.

  The fixtures are shaped from the workspace they are loaded into, so sample
  vendors, products and customers line up with the company on screen. All names
  and amounts are invented.
*/
import { trackingResult } from './normalize.js'

const DAY = 86_400_000
const iso = (now, offsetDays) => new Date(now.getTime() + offsetDays * DAY).toISOString()
const date = (now, offsetDays) => iso(now, offsetDays).slice(0, 10)
const month = (now, back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 12)).toISOString().slice(0, 10)

// Fixed month-to-month variation, so the trend is the same on every run.
const SEASON = [0.92, 1.08, 0.97, 1.14, 0.88, 1.01]

const SAMPLE_SUPPLIERS = [
  { id: 'sample-s-1', name: 'Sample Harbour Metalworks', annualSpend: 480_000 },
  { id: 'sample-s-2', name: 'Sample Coastline Plastics', annualSpend: 210_000 },
]
const SAMPLE_PRODUCTS = [
  { id: 'sample-p-1', name: 'Sample cookware set' },
  { id: 'sample-p-2', name: 'Sample storage containers' },
]

export function demoFinance(ws, now = new Date()) {
  const suppliers = ws?.suppliers?.length ? ws.suppliers : SAMPLE_SUPPLIERS
  const vendors = suppliers.slice(0, 8).map((s, i) => ({ externalId: `demo-v-${i + 1}`, name: s.name, currency: 'CAD', balance: 0, active: true }))
  vendors.push({ externalId: 'demo-v-freight', name: 'Sample Freight Forwarding Co.', currency: 'CAD', balance: 0, active: true })
  const bills = []
  suppliers.slice(0, 8).forEach((s, i) => {
    const monthly = (Number(s.annualSpend) || 120_000) / 12
    SEASON.forEach((factor, back) => {
      // The second vendor runs above its recorded spend, to give the comparison something to show.
      const total = Math.round(monthly * factor * (i === 1 ? 1.18 : 1))
      const open = back === 0
      bills.push({
        externalId: `demo-b-${i + 1}-${back}`, vendorId: `demo-v-${i + 1}`, vendorName: s.name, date: month(now, back), dueDate: month(now, back - 1),
        total, balance: open ? total : 0, currency: 'CAD', lines: [{ account: 'Cost of Goods Sold', description: 'Sample purchase', amount: total }],
      })
    })
  })
  const purchases = SEASON.map((factor, back) => ({
    externalId: `demo-p-${back}`, vendorId: 'demo-v-freight', vendorName: 'Sample Freight Forwarding Co.', date: month(now, back),
    total: Math.round(24_000 * factor), currency: 'CAD', paymentType: 'Check', lines: [{ account: 'Freight and Shipping', description: 'Sample ocean freight', amount: Math.round(24_000 * factor) }],
  }))
  return {
    source: 'QuickBooks Online (sample data)', demo: true, asOf: now.toISOString(), currency: 'CAD', companyName: 'Sample books',
    vendors, bills, purchases,
    accounts: [{ externalId: 'demo-a-1', name: 'Cost of Goods Sold', type: 'Cost of Goods Sold', classification: 'Expense' }, { externalId: 'demo-a-2', name: 'Freight and Shipping', type: 'Expense', classification: 'Expense' }],
    budgets: [],
  }
}

export function demoCommerce(ws, now = new Date()) {
  const products = (ws?.products?.length ? ws.products : SAMPLE_PRODUCTS).slice(0, 6)
  const delayed = new Set((ws?.shipments ?? []).filter((s) => s.status === 'delayed').map((s) => s.productId))
  const list = products.map((p, i) => {
    const late = delayed.has(p.id)
    return {
      externalId: `demo-sp-${i + 1}`, title: p.name, status: 'ACTIVE',
      // Stock is thin exactly where the workspace has a delayed shipment, so the dependency is visible once mapped.
      variants: [{ externalId: `demo-sv-${i + 1}`, title: 'Default Title', sku: `DEMO-${String(i + 1).padStart(3, '0')}`, inventoryQuantity: late ? 14 : 180 + i * 60 }],
    }
  })
  const orders = list.flatMap((p, i) =>
    [0, 1, 2].map((n) => ({
      externalId: `demo-so-${i + 1}-${n}`, name: `#D${1040 + i * 3 + n}`, createdAt: iso(now, -(n + 1)), cancelled: false,
      fulfillmentStatus: n === 2 ? 'FULFILLED' : 'UNFULFILLED', financialStatus: 'PAID',
      lines: [{ title: p.title, sku: p.variants[0].sku, quantity: 12 + n * 9, variantId: p.variants[0].externalId, productId: p.externalId }],
    })),
  )
  return {
    source: 'Shopify (sample data)', demo: true, asOf: now.toISOString(), shop: 'sample-store.myshopify.com', currency: 'CAD',
    products: list, orders,
    locations: [{ externalId: 'demo-loc-1', name: ws?.warehouses?.[0]?.name ?? 'Sample warehouse', city: ws?.warehouses?.[0]?.city ?? 'Toronto', country: 'CA', active: true }],
  }
}

/** Sample mappings for the sample store: each sample product is tied to the workspace product it was built from. */
export function demoCommerceMappings(ws) {
  return (ws?.products ?? []).slice(0, 6).map((p, i) => ({
    id: `demo-map-shopify-${i + 1}`, provider: 'shopify', kind: 'product', externalId: `demo-sp-${i + 1}`, externalLabel: p.name,
    waymarkType: 'product', waymarkId: p.id, demo: true, createdBy: 'Demo Mode', createdAt: new Date(0).toISOString(),
  }))
}

const CUSTOMERS = ['Sample Northgate Retail', 'Sample Lakeshore Hospitality', 'Sample Prairie Home Stores', 'Sample Atlantic Kitchens']

export function demoCrm(ws, now = new Date()) {
  const accounts = CUSTOMERS.map((name, i) => ({ externalId: `demo-acc-${i + 1}`, name, industry: i === 1 ? 'Hospitality' : 'Retail', country: 'Canada' }))
  return {
    source: 'Salesforce (sample data)', demo: true, asOf: now.toISOString(), currency: 'CAD', unavailable: [],
    accounts,
    opportunities: accounts.map((a, i) => ({
      externalId: `demo-opp-${i + 1}`, name: `${a.name}: seasonal order`, accountId: a.externalId, accountName: a.name,
      amount: 42_000 + i * 18_500, stage: i === 3 ? 'Closed Won' : i === 0 ? 'Negotiation/Review' : 'Proposal/Price Quote', closeDate: date(now, 9 + i * 6), probability: 70 - i * 10,
    })),
    orders: accounts.slice(0, 3).map((a, i) => ({
      externalId: `demo-ord-${i + 1}`, number: `0000${310 + i}`, accountId: a.externalId, accountName: a.name, status: i === 2 ? 'Draft' : 'Activated', effectiveDate: date(now, 4 + i * 5), total: 26_400 + i * 9_800,
    })),
  }
}

export function demoCrmMappings(ws) {
  const products = ws?.products ?? []
  if (!products.length) return []
  const delayedProduct = (ws.shipments ?? []).find((s) => s.status === 'delayed')?.productId
  const order = [...products].sort((a) => (a.id === delayedProduct ? -1 : 1))
  return CUSTOMERS.slice(0, 3).map((name, i) => ({
    id: `demo-map-salesforce-${i + 1}`, provider: 'salesforce', kind: 'account', externalId: `demo-acc-${i + 1}`, externalLabel: name,
    waymarkType: 'product', waymarkId: order[i % order.length].id, demo: true, createdBy: 'Demo Mode', createdAt: new Date(0).toISOString(),
  }))
}

/** Sample tracking for one shipment. The position is invented and is never called live. */
export function demoTracking(provider, shipment, now = new Date()) {
  const sea = shipment.mode !== 'air'
  const origin = shipment.legs?.find((l) => l.mode === 'sea' || l.mode === 'air')?.from?.name ?? 'Origin hub'
  const dest = shipment.legs?.find((l) => l.mode === 'sea' || l.mode === 'air')?.to?.name ?? 'Destination hub'
  const late = shipment.status === 'delayed'
  return trackingResult({
    provider, demo: true, reference: shipment.containerNo || shipment.awb || shipment.reference,
    status: late ? 'Delayed in transit' : shipment.status === 'at_port' ? 'At destination port' : 'Under way',
    lastLocation: { name: shipment.status === 'at_port' ? dest : sea ? 'North Pacific (sample position)' : 'In flight (sample position)', lat: 41.2, lon: -168.4, at: iso(now, -0.25) },
    eta: shipment.eta ? `${shipment.eta}T16:00:00.000Z` : null,
    vessel: sea ? { name: 'MV Sample Voyager', imo: '9000001', mmsi: '316000001', speedKnots: late ? 9.5 : 17.2 } : null,
    delaySignal: late ? 'Sample signal: vessel speed is below schedule speed.' : null,
    events: [
      { at: iso(now, -0.25), type: 'position', description: 'Position reported (sample)', location: sea ? 'North Pacific' : 'En route' },
      { at: iso(now, -6), type: 'departure', description: `Departed ${origin}`, location: origin },
      { at: iso(now, -8), type: 'gate_in', description: 'Cargo received at terminal', location: origin },
    ],
  }, now)
}

/**
 * The scripted weather disruption used by the guided demo. It is a simulated
 * forecast for the first active ocean shipment's destination hub.
 */
export function demoWeatherScenario(model, now = new Date()) {
  const shipment = model.shipments.find((s) => s.active && s.mode === 'sea' && s.status !== 'delayed') ?? model.shipments.find((s) => s.active)
  if (!shipment) return null
  const hub = [...shipment.legs].reverse().find((l) => l.to?.code)?.to ?? shipment.legs[shipment.legs.length - 1]?.to
  if (!hub) return null
  return {
    shipmentId: shipment.id,
    hub: { code: hub.code ?? null, name: hub.name, lat: hub.lat, lon: hub.lon },
    weather: {
      simulated: true,
      source: 'Simulated forecast (Demo Mode)',
      retrievedAt: now.toISOString(),
      days: [0, 1, 2].map((n) => ({ date: date(now, n), weatherCode: n === 1 ? 82 : 61, windKmh: n === 1 ? 78 : 34, precipitationMm: n === 1 ? 46 : 6 })),
      alerts: [{ date: date(now, 1), kind: 'Gale-force wind forecast (78 km/h)' }, { date: date(now, 1), kind: 'Violent rain showers' }],
    },
  }
}

export const DEMO_DATASETS = {
  quickbooks: { dataset: 'finance', build: demoFinance, mappings: () => [] },
  shopify: { dataset: 'commerce', build: demoCommerce, mappings: demoCommerceMappings },
  salesforce: { dataset: 'crm', build: demoCrm, mappings: demoCrmMappings },
}
