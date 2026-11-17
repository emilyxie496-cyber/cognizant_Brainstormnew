/*
  Provider records to Waymark's own shapes. Each function takes the provider's
  raw response rows and returns plain objects with stable field names, so pages
  and agent tools never depend on a provider's wire format.

  Free-text fields from providers are trimmed and length-capped here. They are
  third-party content and are treated as data everywhere downstream.
*/

const text = (value, max = 160) => (value == null ? null : String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null)
const amount = (value) => {
  const n = Number(value)
  return value === '' || value == null || !Number.isFinite(n) ? null : n
}
const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value ?? '')) ? String(value).slice(0, 10) : null)

/* ---------- QuickBooks Online ---------- */

const qbLines = (lines) =>
  (lines ?? [])
    .filter((l) => l.Amount != null && l.DetailType !== 'SubTotalLineDetail')
    .slice(0, 25)
    .map((l) => ({
      account: text(l.AccountBasedExpenseLineDetail?.AccountRef?.name ?? l.ItemBasedExpenseLineDetail?.ItemRef?.name ?? null, 80),
      description: text(l.Description, 120),
      amount: amount(l.Amount),
    }))

export function normalizeQuickBooks({ vendors = [], bills = [], purchases = [], accounts = [], budgets = [], company = null }, now = new Date()) {
  return {
    source: 'QuickBooks Online',
    asOf: now.toISOString(),
    currency: text(company?.currency ?? bills[0]?.CurrencyRef?.value ?? 'CAD', 3),
    companyName: text(company?.name, 120),
    vendors: vendors.map((v) => ({ externalId: String(v.Id), name: text(v.DisplayName ?? v.CompanyName), currency: text(v.CurrencyRef?.value, 3), balance: amount(v.Balance), active: v.Active !== false })),
    bills: bills.map((b) => ({
      externalId: String(b.Id), vendorId: b.VendorRef?.value ? String(b.VendorRef.value) : null, vendorName: text(b.VendorRef?.name),
      date: day(b.TxnDate), dueDate: day(b.DueDate), total: amount(b.TotalAmt), balance: amount(b.Balance), currency: text(b.CurrencyRef?.value, 3), lines: qbLines(b.Line),
    })),
    // A Purchase is an expense paid at the time (cheque, card, cash). Only those naming a vendor are kept.
    purchases: purchases.filter((p) => p.EntityRef?.type === 'Vendor' || p.EntityRef?.value).map((p) => ({
      externalId: String(p.Id), vendorId: p.EntityRef?.value ? String(p.EntityRef.value) : null, vendorName: text(p.EntityRef?.name),
      date: day(p.TxnDate), total: amount(p.TotalAmt), currency: text(p.CurrencyRef?.value, 3), paymentType: text(p.PaymentType, 20), lines: qbLines(p.Line),
    })),
    accounts: accounts.map((a) => ({ externalId: String(a.Id), name: text(a.Name, 80), type: text(a.AccountType, 40), classification: text(a.Classification, 20) })),
    budgets: budgets.map((b) => ({ externalId: String(b.Id), name: text(b.Name, 80), startDate: day(b.StartDate), endDate: day(b.EndDate), type: text(b.BudgetType, 30), total: (b.BudgetDetail ?? []).reduce((s, d) => s + (Number(d.Amount) || 0), 0) })),
  }
}

/* ---------- Salesforce ---------- */

export function normalizeSalesforce({ accounts = [], opportunities = [], orders = [], unavailable = [], currency = null }, now = new Date()) {
  return {
    source: 'Salesforce',
    asOf: now.toISOString(),
    currency: text(currency, 3),
    unavailable,
    accounts: accounts.map((a) => ({ externalId: a.Id, name: text(a.Name), industry: text(a.Industry, 60), country: text(a.BillingCountry, 60) })),
    opportunities: opportunities.map((o) => ({
      externalId: o.Id, name: text(o.Name), accountId: o.AccountId ?? null, accountName: text(o.Account?.Name), amount: amount(o.Amount),
      stage: text(o.StageName, 60), closeDate: day(o.CloseDate), probability: amount(o.Probability),
    })),
    orders: orders.map((o) => ({
      externalId: o.Id, number: text(o.OrderNumber, 40), accountId: o.AccountId ?? null, accountName: text(o.Account?.Name),
      status: text(o.Status, 40), effectiveDate: day(o.EffectiveDate), total: amount(o.TotalAmount),
    })),
  }
}

/* ---------- Shopify (Admin GraphQL) ---------- */

const gid = (id) => String(id ?? '').split('/').pop() || null
const nodes = (connection) => connection?.nodes ?? (connection?.edges ?? []).map((e) => e.node)

export function normalizeShopify({ products = [], orders = [], locations = [], shop = null, currency = null }, now = new Date()) {
  return {
    source: 'Shopify',
    asOf: now.toISOString(),
    shop: text(shop, 100),
    currency: text(currency, 3),
    products: products.map((p) => ({
      externalId: gid(p.id), title: text(p.title), status: text(p.status, 20),
      variants: nodes(p.variants).map((v) => ({ externalId: gid(v.id), title: text(v.title, 80), sku: text(v.sku, 60), inventoryQuantity: amount(v.inventoryQuantity) })),
    })),
    // Customer identity is deliberately not requested or stored.
    orders: orders.map((o) => ({
      externalId: gid(o.id), name: text(o.name, 40), createdAt: o.createdAt ?? null, cancelled: Boolean(o.cancelledAt),
      fulfillmentStatus: text(o.displayFulfillmentStatus, 30), financialStatus: text(o.displayFinancialStatus, 30),
      lines: nodes(o.lineItems).map((l) => ({ title: text(l.title), sku: text(l.sku, 60), quantity: amount(l.unfulfilledQuantity ?? l.quantity), variantId: gid(l.variant?.id), productId: gid(l.variant?.product?.id ?? l.product?.id) })),
    })),
    locations: locations.map((l) => ({ externalId: gid(l.id), name: text(l.name, 80), city: text(l.address?.city, 60), country: text(l.address?.countryCode, 2), active: l.isActive !== false })),
  }
}

/* ---------- Logistics ---------- */

/** The contract every tracking provider maps onto. Unknown fields stay null. */
export function trackingResult({ provider, reference, status = null, lastLocation = null, eta = null, vessel = null, events = [], delaySignal = null, demo = false }, now = new Date()) {
  return {
    provider,
    reference: text(reference, 60),
    status: text(status, 60),
    lastLocation: lastLocation ? { name: text(lastLocation.name, 100), lat: amount(lastLocation.lat), lon: amount(lastLocation.lon), at: lastLocation.at ?? null } : null,
    eta: eta ?? null,
    vessel: vessel ? { name: text(vessel.name, 80), imo: text(vessel.imo, 12), mmsi: text(vessel.mmsi, 12), speedKnots: amount(vessel.speedKnots) } : null,
    events: events.slice(0, 40).map((e) => ({ at: e.at ?? null, type: text(e.type, 40), description: text(e.description, 200), location: text(e.location, 100) })).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    delaySignal: text(delaySignal, 200),
    syncedAt: now.toISOString(),
    demo,
  }
}

export function normalizeMarineTraffic(rows, reference) {
  const v = Array.isArray(rows) ? rows[0] : rows
  if (!v) return null
  return trackingResult({
    provider: 'marinetraffic', reference,
    status: v.STATUS_NAME ?? v.NAVSTAT ?? null,
    lastLocation: { name: v.CURRENT_PORT || v.LAST_PORT || 'At sea', lat: v.LAT, lon: v.LON, at: v.TIMESTAMP ? new Date(`${v.TIMESTAMP}Z`).toISOString() : null },
    eta: v.ETA ? new Date(`${v.ETA}Z`).toISOString() : null,
    vessel: { name: v.SHIPNAME, imo: v.IMO, mmsi: v.MMSI, speedKnots: v.SPEED != null ? Number(v.SPEED) / 10 : null },
    events: v.LAST_PORT ? [{ at: v.LAST_PORT_TIME ? new Date(`${v.LAST_PORT_TIME}Z`).toISOString() : null, type: 'port_departure', description: `Departed ${v.LAST_PORT}`, location: v.LAST_PORT }] : [],
  })
}

export function normalizeProject44(body, reference) {
  const s = body?.shipments?.[0] ?? body?.shipment ?? body
  if (!s) return null
  const events = (s.events ?? s.states ?? []).map((e) => ({ at: e.dateTime ?? e.startDateTime ?? null, type: e.type ?? e.stateType ?? null, description: e.description ?? e.type ?? null, location: e.stop?.location?.name ?? e.location?.name ?? null }))
  const position = (s.positions ?? []).slice(-1)[0]
  const predicted = (s.events ?? []).find((e) => e.estimateDateTime && /ARRIVAL|DELIVER/i.test(e.type ?? ''))
  return trackingResult({
    provider: 'project44', reference,
    status: s.status ?? s.latestStatus ?? null,
    lastLocation: position ? { name: position.locationName ?? 'Reported position', lat: position.latitude, lon: position.longitude, at: position.dateTime ?? null } : null,
    eta: predicted?.estimateDateTime ?? null,
    events,
    delaySignal: s.delayReason ?? null,
  })
}
