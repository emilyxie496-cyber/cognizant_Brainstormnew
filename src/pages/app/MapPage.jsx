import WeatherIntelligence from '../../components/app/WeatherIntelligence.jsx'
import AnalyzeButton from '../../components/app/AnalyzeButton.jsx'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { countryName } from '../../../shared/countries.js'
import { formatCo2e } from '../../../shared/emissions.js'
import { Card, CollapsiblePanel, CompactPageHeader, DemoTag, Gate, SearchInput, SectionTabs, SelectInput } from '../../components/app/kit.jsx'
import AiLauncher from '../../components/app/AiLauncher.jsx'
import ShipmentDetail from '../../components/app/ShipmentDetail.jsx'
import SupplyMap, { MapLegend } from '../../components/map/SupplyMap.jsx'
import { DEFAULT_FILTERS, NODE_STYLES, buildMapData } from '../../components/map/mapData.js'
import { Badge, Button } from '../../components/ui.jsx'
import { MODES, SHIPMENT_STATUSES, modeLabel, statusLabel } from '../../engine/model.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money, percent } from '../../utils/format.js'

function SupplierPanel({ supplier: s }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold text-navy">{s.name}</h3>
        {s.point?.precision === 'country' && <Badge tone="amber">Country-level location</Badge>}
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        {[
          ['Location', s.point?.precision === 'country' ? `${countryName(s.country)} (city unknown)` : `${s.city}, ${countryName(s.country)}`],
          ['Annual spending', s.spendCad ? money(s.spendCad) : 'Not recorded'],
          ['Share of sourcing', percent(s.share, 0)],
          ['Lead time', s.leadTimeDays ? `${s.leadTimeDays} days` : 'Not recorded'],
          ['Shipping mode', modeLabel(s.mode)],
          ['Annual lane emissions', s.annualEmissions ? `${formatCo2e(s.annualEmissions.co2eKg)} (estimate)` : 'Add annual cargo weight'],
          ['Documentation', `${s.complianceSummary.verified} verified, ${s.complianceSummary.claimed} claimed, ${s.complianceSummary.unknown} unknown`],
          ['Hazard exposure', s.countryInfo?.hazard ?? 'Unknown'],
        ].map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <Link to="/app/canadian" className="mt-3 inline-block text-sm font-semibold text-brand-800 hover:underline">Find alternatives</Link>
    </div>
  )
}

/** Searchable locations and routes: the readable, keyboard-friendly companion to the map drawing. */
function LayersPanel({ data, onSelect }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const routes = [...new Map(data.segments.filter((s) => s.kind === 'shipment').map((s) => [s.routeId, s])).values()].map((r) => {
    const legs = data.segments.filter((s) => s.routeId === r.routeId)
    const ref = data.vehicles.find((v) => v.shipmentId === r.shipmentId)?.reference ?? r.routeId
    return { ...r, ref, modes: [...new Set(legs.map((l) => modeLabel(l.mode)))].join(' + ') }
  })
  const nodes = data.nodes.filter((n) => !q || `${n.label} ${n.detail ?? ''}`.toLowerCase().includes(q))
  const shown = routes.filter((r) => !q || `${r.ref} ${r.modes}`.toLowerCase().includes(q))
  const item = 'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-slate-100'
  return (
    <div className="space-y-2">
      <SearchInput label="Search locations and routes" value={query} onChange={setQuery} />
      <SectionTabs idPrefix="layers" label="Map layers" tabs={[
        { id: 'locations', label: 'Locations', count: nodes.length, content: (
          <ul className="wm-scroll max-h-[24rem] overflow-y-auto">
            {nodes.map((n) => (
              <li key={n.id}><button type="button" className={item} onClick={() => onSelect({ type: 'node', node: n })}>
                <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: NODE_STYLES[n.kind]?.color ?? '#94a3b8' }} />
                <span className="min-w-0"><span className="block font-medium text-navy">{n.label}</span><span className="block truncate text-xs text-slate-500">{NODE_STYLES[n.kind]?.label}{n.detail ? ` · ${n.detail}` : ''}{n.affected ? ' · affected' : ''}</span></span>
              </button></li>
            ))}
            {!nodes.length && <li className="px-2 py-2 text-sm text-slate-500">No matching locations.</li>}
          </ul>
        ) },
        { id: 'routes', label: 'Routes', count: shown.length, content: (
          <ul className="wm-scroll max-h-[24rem] overflow-y-auto">
            {shown.map((r) => (
              <li key={r.routeId}><button type="button" className={item} onClick={() => onSelect({ type: 'shipment', id: r.shipmentId })}>
                <span className="min-w-0 flex-1"><span className="block font-medium text-navy">{r.ref}</span><span className="block text-xs text-slate-500">{r.modes} · {statusLabel(r.status)}</span></span>
                <Badge tone={r.risk === 'high' ? 'rose' : r.risk === 'medium' ? 'amber' : 'slate'}>{r.risk}</Badge>
              </button></li>
            ))}
            {!shown.length && <li className="px-2 py-2 text-sm text-slate-500">No routes match the current filters.</li>}
          </ul>
        ) },
      ]} />
    </div>
  )
}

export default function MapPage() {
  const { model, isDemo, can } = useWorkspace()
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, status: 'all' })
  const [selection, setSelection] = useState(null)
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value || 'all' }))

  const data = useMemo(
    () => buildMapData(model, { filters, selectedId: selection?.type === 'shipment' ? selection.id : null }),
    [model, filters, selection],
  )

  const shipment = selection?.type === 'shipment' ? model.shipments.find((s) => s.id === selection.id) : null
  const supplierId = selection?.type === 'supplier' ? selection.id : selection?.type === 'node' && selection.node.kind === 'supplier' ? selection.node.refId : null
  const supplier = supplierId ? model.supplierById.get(supplierId) : null
  const node = selection?.type === 'node' && !supplier ? selection.node : null
  const activeFilters = Object.entries(filters).filter(([k, v]) => v !== 'all' && v !== DEFAULT_FILTERS[k]).length

  const options = {
    suppliers: [{ value: 'all', label: 'All suppliers' }, ...model.suppliers.map((s) => ({ value: s.id, label: s.name }))],
    products: [{ value: 'all', label: 'All products' }, ...model.products.map((p) => ({ value: p.id, label: p.name }))],
  }
  const aiTask = shipment ? `Investigate risks for shipment ${shipment.reference}.` : 'Which routes on my supply-chain map carry the most risk right now, and why?'
  const aiContext = shipment ? [`Shipment ${shipment.reference}`, `Status: ${statusLabel(shipment.status)}`, `Route risk: ${shipment.risk?.level ?? 'unknown'}`] : [`${data.segments.length} route segments shown`, `${activeFilters} filter(s) applied`]

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Supply Chain Map" badge={isDemo && <DemoTag />} description="Suppliers, hubs and shipments. Routes are schematic; markers come from schedules, not live tracking."
        actions={<AiLauncher task={aiTask} context={aiContext} />} />

      <WeatherIntelligence shipment={shipment} />

      <CollapsiblePanel title="Filters" summary={activeFilters ? `${activeFilters} active` : 'Showing everything'} defaultOpen={activeFilters > 0}>
        <div data-tour="feature-map" className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <SelectInput label="Direction" placeholder={null} value={filters.direction} onChange={set('direction')} options={[{ value: 'all', label: 'All' }, { value: 'import', label: 'Import' }, { value: 'export', label: 'Export' }]} />
          <SelectInput label="Transport mode" placeholder={null} value={filters.mode} onChange={set('mode')} options={[{ value: 'all', label: 'All modes' }, ...MODES]} />
          {can('map.advanced') && (
            <>
              <SelectInput label="Supplier" placeholder={null} value={filters.supplier} onChange={set('supplier')} options={options.suppliers} />
              <SelectInput label="Product" placeholder={null} value={filters.product} onChange={set('product')} options={options.products} />
              <SelectInput label="Status" placeholder={null} value={filters.status} onChange={set('status')} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active only' }, ...SHIPMENT_STATUSES]} />
              <SelectInput label="Route risk" placeholder={null} value={filters.risk} onChange={set('risk')} options={[{ value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
              <SelectInput label="Carbon emissions" placeholder={null} value={filters.carbon} onChange={set('carbon')} options={[{ value: 'all', label: 'All' }, { value: 'high', label: 'Over 5 t CO₂e' }]} />
            </>
          )}
        </div>
        {!can('map.advanced') && <div className="mt-3"><Gate feature="map.advanced" /></div>}
      </CollapsiblePanel>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-2">
          <Card padded={false} className="overflow-hidden p-1.5">
            <SupplyMap data={data} onSelect={setSelection} textList={false} className="h-[60vh] min-h-[22rem] lg:h-[calc(100dvh-17rem)] lg:min-h-[30rem]" label="Interactive supply-chain map" />
          </Card>
          <MapLegend />
        </div>
        <Card title={shipment ? 'Shipment' : supplier ? 'Supplier' : node ? 'Location' : 'Layers and locations'} className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto"
          aside={selection && <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>Back to list</Button>}>
          {shipment && <ShipmentDetail shipment={shipment} />}
          {supplier && <div className="mb-2"><AnalyzeButton type="supplier" id={supplier.id} /></div>}
          {supplier && <SupplierPanel supplier={supplier} />}
          {node && (
            <div>
              <h3 className="text-lg font-bold text-navy">{node.label}</h3>
              <p className="text-sm text-slate-600">{NODE_STYLES[node.kind]?.label}{node.detail ? ` · ${node.detail}` : ''}</p>
              <p className="mt-1 text-xs text-slate-500">{node.lat.toFixed(2)}, {node.lon.toFixed(2)}{node.affected ? ' · Affected by scenario' : ''}</p>
            </div>
          )}
          {!selection && <LayersPanel data={data} onSelect={setSelection} />}
        </Card>
      </div>
    </div>
  )
}
