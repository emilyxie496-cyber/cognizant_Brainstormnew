import { customerImpact, inventoryRisk, suggestProductMappings } from '../../../shared/business.js'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Card, CollapsiblePanel, CompactPageHeader, DataTable, Drawer, Metric, MetricGrid, Notice, Pager, SearchInput, SectionTabs, StatusPill, usePaged } from '../../components/app/kit.jsx'
import AiLauncher from '../../components/app/AiLauncher.jsx'
import ReportAction from '../../components/app/ReportAction.jsx'
import { Badge, Button } from '../../components/ui.jsx'
import { Evidence, Feedback, Investigate, usePlatform } from '../../components/app/PlatformKit.jsx'
import { useState } from 'react'

export function MappingForm({ provider, records, targets, mappings, reload }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="space-y-3 text-sm">{message && <Notice>{message}</Notice>}{records.map(r => { const mapped = mappings?.find(m => m.provider === provider && m.externalId === r.id); return <form key={r.id} className="flex flex-wrap items-center gap-2" onSubmit={async e => { e.preventDefault(); const id = new FormData(e.currentTarget).get('target'); setBusy(true); try { if(id) await platform.saveMapping({ provider, externalId: r.id, externalLabel: r.name, waymarkId: id }); else if(mapped) await platform.removeMapping(mapped.id); await reload(); setMessage('Mapping saved.') } catch(e) { setMessage(e.message) } finally { setBusy(false) } }}><label>{r.name}<select name="target" key={mapped?.waymarkId ?? 'unlinked'} defaultValue={mapped?.waymarkId ?? ''} className="ms-2 rounded border p-2"><option value="">Unlinked</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><Button disabled={busy} type="submit" variant="secondary">Save mapping</Button></form> })}</div>
}
const LEVEL_TONE = { stockout: 'rose', short: 'amber', low: 'amber', ok: 'emerald' }

export default function Inventory() {
  const { model, ws, isDemo } = useWorkspace()
  const state = usePlatform(platform.businessData)
  const data = state.data
  const stock = data && inventoryRisk(data.commerce, data.mappings, model)
  const crm = data && customerImpact(data.crm, data.mappings, model)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState(null)
  const q = query.trim().toLowerCase()
  const products = ws.products.filter((p) => !q || `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(q))
  const pagedProducts = usePaged(products, 12, q)
  const stockRows = (stock?.rows ?? []).filter((r) => !q || `${r.title} ${r.sku ?? ''}`.toLowerCase().includes(q))
  const pagedStock = usePaged(stockRows, 12, q)
  const inboundOf = (p) => model.shipments.filter((s) => s.active && s.productId === p.id)

  const buildReport = () => ({
    title: 'Inventory and customer exposure',
    typeId: 'inventory',
    sections: [
      { heading: 'Executive summary', paragraphs: [stock ? `${stock.counts.stockout} stockout(s), ${stock.counts.short} short-stock item(s) and ${stock.openOrderCount} open store order(s) in ${stock.source} (${stock.demo ? 'sample data' : 'synced records'}, as of ${stock.asOf}).` : 'No store dataset is connected.', crm ? `${crm.affected.length} customer commitment(s) potentially affected.` : 'No CRM dataset is connected.'] },
      { heading: 'Recorded product inventory', table: { head: ['Product', 'SKU', 'On hand', 'Inbound shipments'], rows: ws.products.map((p) => [p.name, p.sku ?? '', p.onHand ?? 'Not recorded', inboundOf(p).map((s) => `${s.reference} (${s.status}, ETA ${s.eta ?? 'unknown'})`).join('; ') || 'None']) } },
      ...(stock ? [{ heading: 'Store stock and supply exposure', table: { head: ['Item', 'Level', 'On hand', 'Open demand', 'Supply dependency'], rows: stock.rows.map((r) => [r.title, r.level, r.onHand ?? 'unknown', r.openDemand, r.supplyRisk]) }, paragraphs: stock.notes }] : []),
      ...(crm ? [{ heading: 'Customer impact', table: { head: ['Customer', 'Commitment', 'Status', 'Detail'], rows: crm.commitments.map((c) => [c.customer, c.label, c.status, c.detail]) }, paragraphs: crm.notes }] : []),
      { heading: 'Assumptions and limitations', bullets: ['Exposure is estimated from mapped inbound shipments and does not confirm a late customer delivery.', 'Stock quantities are recorded or synced facts at the stated time, not live availability.'] },
    ],
    sources: [{ label: 'Company records', detail: isDemo ? 'Fictional demo data' : 'Entered by your company' }, ...(stock ? [{ label: stock.source, detail: `${stock.demo ? 'Sample data' : 'Synced'} · ${stock.asOf}` }] : []), ...(crm ? [{ label: crm.source, detail: `${crm.demo ? 'Sample data' : 'Synced'} · ${crm.asOf}` }] : [])],
  })

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Inventory & Orders" description="Recorded stock and orders, with estimated exposure from mapped inbound shipments. Exposure does not confirm a late customer delivery."
        actions={<>
          <AiLauncher task="Which customer orders and products could be affected by the latest disruption?" context={[`${ws.products.length} products`, stock ? `${stock.counts.stockout} stockouts, ${stock.counts.short} short` : 'No store data', crm ? `${crm.affected.length} commitments potentially affected` : 'No CRM data']} />
          <ReportAction build={buildReport} disabled={!ws.products.length && !stock} />
        </>} />
      <Feedback state={state} />

      <MetricGrid max={4}>
        <Metric label="Inventory risks" value={stock ? stock.counts.stockout + stock.counts.short : '—'} sub={stock ? `${stock.counts.stockout} stockouts · ${stock.counts.short} short` : 'No store data'} tone={stock?.counts.stockout ? 'bad' : stock?.counts.short ? 'warn' : 'default'} />
        <Metric label="Open orders" value={stock ? stock.openOrderCount : '—'} sub={stock ? `${stock.affectedOrders?.length ?? 0} potentially affected` : undefined} />
        <Metric label="Customer impact" value={crm ? crm.affected.length : '—'} sub={crm ? 'commitments potentially affected' : 'No CRM data'} tone={crm?.affected.length ? 'warn' : 'default'} />
        <Metric label="Data freshness" value={stock?.asOf ?? crm?.asOf ?? 'Records only'} sub={stock?.demo || crm?.demo ? 'Sample data' : stock || crm ? 'Synced provider records' : 'Company records'} />
      </MetricGrid>

      <Card padded>
        <div className="mb-2"><SearchInput label="Search products and SKUs" value={query} onChange={setQuery} className="sm:w-80" /></div>
        <SectionTabs idPrefix="inv" label="Inventory and orders" tabs={[
          { id: 'inventory', label: 'Inventory', count: ws.products.length, content: (
            <div data-tour="inventory-records">
              <DataTable caption="Waymark inventory records" rowKey={(p) => p.id} rows={pagedProducts.rows} onRowClick={(p) => setDetail({ kind: 'product', p })} empty={<p className="py-3 text-sm text-slate-500">No products recorded. Import products from Integrations or add them in Settings.</p>} columns={[
                { key: 'name', label: 'Product', render: (p) => <span className="font-semibold text-navy">{p.name}</span> },
                { key: 'sku', label: 'SKU', render: (p) => p.sku || '—' },
                { key: 'onhand', label: 'On hand', right: true, render: (p) => p.onHand ?? <span className="text-slate-400">Not recorded</span> },
                { key: 'cost', label: 'Unit cost', right: true, render: (p) => (p.unitCost == null ? '—' : `${p.unitCost} ${p.currency ?? 'CAD'}`) },
                { key: 'inbound', label: 'Inbound', render: (p) => { const n = inboundOf(p); return n.length ? <span className="text-xs">{n.length} shipment(s){n.some((s) => s.status === 'delayed') && <Badge tone="rose">delayed</Badge>}</span> : <span className="text-xs text-slate-400">None</span> } },
              ]} />
              <Pager paged={pagedProducts} label="Product pages" />
            </div>
          ) },
          { id: 'orders', label: 'Store stock & orders', count: stock?.rows.length, content: stock ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{stock.source} · <Badge tone={stock.demo ? 'amber' : 'emerald'}>{stock.demo ? 'Sample data' : 'Synced records'}</Badge> · {stock.asOf}</p>
              <DataTable caption="Store stock and supply exposure" rowKey={(r) => r.variantId} rows={pagedStock.rows} onRowClick={(r) => setDetail({ kind: 'stock', r })} columns={[
                { key: 'title', label: 'Item', render: (r) => <span className="font-semibold text-navy">{r.title}</span> },
                { key: 'level', label: 'Level', render: (r) => <StatusPill tone={LEVEL_TONE[r.level] ?? 'slate'}>{r.level}</StatusPill> },
                { key: 'onhand', label: 'On hand', right: true, render: (r) => r.onHand ?? '?' },
                { key: 'demand', label: 'Open demand', right: true, render: (r) => r.openDemand },
                { key: 'risk', label: 'Supply', render: (r) => <span className="text-xs">{r.supplyRisk.replace(/_/g, ' ')}</span> },
              ]} />
              <Pager paged={pagedStock} label="Stock pages" />
              <CollapsiblePanel title="Potentially affected orders" summary={`${stock.affectedOrders?.length ?? 0} order(s)`}><Evidence value={stock.affectedOrders} label="Order records" /></CollapsiblePanel>
              {stock.notes.map((n) => <p key={n} className="text-xs text-slate-500">{n}</p>)}
            </div>
          ) : <Notice>No store dataset is available. Connect Shopify or load sample data in a demo workspace.</Notice> },
          { id: 'customers', label: 'Customer impact', count: crm?.commitments.length, content: crm ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{crm.source} · <Badge tone={crm.demo ? 'amber' : 'emerald'}>{crm.demo ? 'Sample data' : 'Synced records'}</Badge> · {crm.asOf} · Currency: {crm.currency ?? 'unspecified; values are not combined with CAD estimates'}</p>
              <DataTable caption="Customer commitments" rowKey={(c) => `${c.type}:${c.externalId}`} rows={crm.commitments} onRowClick={(c) => setDetail({ kind: 'customer', c })} columns={[
                { key: 'customer', label: 'Customer', render: (c) => <span className="font-semibold text-navy">{c.customer}</span> },
                { key: 'label', label: 'Commitment', render: (c) => c.label },
                { key: 'status', label: 'Exposure', render: (c) => <StatusPill tone={c.shipments.length ? 'amber' : 'slate'}>{c.status}</StatusPill> },
                { key: 'ships', label: 'Shipments', render: (c) => <span className="text-xs">{c.shipments.join(', ') || '—'}</span> },
              ]} />
              {crm.notes.map((n) => <p key={n} className="text-xs text-slate-500">{n}</p>)}
            </div>
          ) : <Notice>No CRM dataset is available. Customer impact requires recorded commitments and confirmed product mappings.</Notice> },
          { id: 'mapping', label: 'Product mapping', content: data ? (
            <div data-tour="inventory-mapping" className="space-y-3">
              <CollapsiblePanel title="Store products → Waymark products" summary="Shopify" defaultOpen><MappingForm provider="shopify" records={(data.commerce?.products ?? []).map((p) => ({ id: p.externalId, name: p.title }))} targets={ws.products} mappings={data.mappings} reload={state.reload} /></CollapsiblePanel>
              {crm && <CollapsiblePanel title="CRM accounts → Waymark products" summary="Salesforce"><MappingForm provider="salesforce" records={crm.accounts.map((a) => ({ id: a.externalId, name: a.name }))} targets={ws.products} mappings={data.mappings} reload={state.reload} /></CollapsiblePanel>}
              <Evidence value={suggestProductMappings(data.commerce, data.mappings, model)} label="Suggestions to review (never applied automatically)" />
            </div>
          ) : <Feedback state={state} /> },
        ]} />
      </Card>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.kind === 'product' ? detail.p.name : detail?.kind === 'stock' ? detail.r.title : detail?.kind === 'customer' ? `${detail.c.customer}: ${detail.c.label}` : ''}>
        {detail?.kind === 'product' && (
          <div className="space-y-2 text-sm">
            <p>SKU: {detail.p.sku || 'none'} · On hand: {detail.p.onHand ?? 'not recorded'} · Source: {detail.p.dataSource ?? 'Company records'}</p>
            <ul className="space-y-1">{inboundOf(detail.p).map((s) => <li key={s.id} className="rounded-lg border border-slate-200 px-2 py-1">{s.reference} · {s.status} · ETA {s.eta ?? 'unknown'}</li>)}</ul>
            {!inboundOf(detail.p).length && <p className="text-slate-500">No inbound shipment records.</p>}
            <Investigate task={`Investigate inventory and inbound shipment risks for ${detail.p.name}`} />
          </div>
        )}
        {detail?.kind === 'stock' && (
          <div className="space-y-2 text-sm">
            <p>SKU {detail.r.sku ?? 'unknown'} · on hand {detail.r.onHand ?? 'unknown'} · demand {detail.r.openDemand} · net {detail.r.net ?? 'unknown'}</p>
            <p>Supply dependency: {detail.r.supplyRisk}; linked product: {detail.r.waymarkProductName ?? 'Unlinked'}</p>
            <Evidence value={detail.r.inbound} label="Inbound shipments and ETAs" />
            <Investigate task={`Investigate stock and customer exposure for ${detail.r.title}`} />
          </div>
        )}
        {detail?.kind === 'customer' && (
          <div className="space-y-2 text-sm">
            <p>{detail.c.detail}</p>
            <p className="text-xs text-slate-500">{detail.c.amount != null ? `Amount: ${detail.c.amount} ${crm?.currency ?? ''}` : ''} {detail.c.date ? `· Date: ${detail.c.date}` : ''}</p>
            <Investigate task={`Investigate ${detail.c.label} for ${detail.c.customer} and ${detail.c.shipments.join(', ')}`} />
          </div>
        )}
      </Drawer>
    </div>
  )
}
