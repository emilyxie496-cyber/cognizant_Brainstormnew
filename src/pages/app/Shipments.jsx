import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatCo2e } from '../../../shared/emissions.js'
import { findPlace } from '../../../shared/places.js'
import ActivityFeed from '../../components/app/ActivityFeed.jsx'
import { BoundedList, Card, CompactPageHeader, ConfirmModal, DataTable, DemoTag, Drawer, Empty, Gate, Notice, Pager, SearchInput, SectionTabs, SelectInput, SourceLine, Spinner, StatusPill, formatDate, usePaged, useToast } from '../../components/app/kit.jsx'
import AiLauncher from '../../components/app/AiLauncher.jsx'
import ShipmentDetail from '../../components/app/ShipmentDetail.jsx'
import ShipmentForm from '../../components/app/ShipmentForm.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { delayState } from '../../engine/delayPlan.js'
import { MODES, SHIPMENT_STATUSES, modeLabel, statusLabel } from '../../engine/model.js'
import { api } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money } from '../../utils/format.js'

const SORTERS = {
  eta: (s) => s.eta ?? '',
  reference: (s) => s.reference ?? '',
  cost: (s) => s.costCad ?? 0,
  emissions: (s) => s.emissions?.co2eKg ?? 0,
}

const STATUS_TONE = { delayed: 'rose', arrived: 'emerald', in_transit: 'sky', at_port: 'brand' }

/** Live aircraft near a hub. Positions never identify cargo or a specific shipment. */
function AircraftPanel() {
  const { model } = useWorkspace()
  const hubs = useMemo(() => {
    const codes = new Set(model.shipments.filter((s) => s.mode === 'air' && s.active).flatMap((s) => [s.destHub, s.originHub]).filter(Boolean))
    return [...codes].map(findPlace).filter(Boolean)
  }, [model])
  const [hub, setHub] = useState('')
  const [state, setState] = useState({ loading: false, data: null, error: null })

  const check = async () => {
    const place = findPlace(hub || hubs[0]?.code)
    if (!place) return
    setState({ loading: true, data: null, error: null })
    try {
      setState({ loading: false, data: { ...(await api.aircraft(place.lat, place.lon)), place }, error: null })
    } catch (err) {
      setState({ loading: false, data: null, error: err.message })
    }
  }

  if (!hubs.length) return <p className="text-sm text-slate-600">Add an active air shipment to check aircraft near its airports.</p>
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <SelectInput label="Airport" placeholder={null} value={hub || hubs[0].code} onChange={setHub} options={hubs.map((h) => ({ value: h.code, label: `${h.name} (${h.code})` }))} className="min-w-52 flex-1" />
        <Button variant="secondary" onClick={check} disabled={state.loading}>Check live aircraft</Button>
      </div>
      {state.loading && <div className="mt-2"><Spinner label="Asking OpenSky" /></div>}
      {state.error && <Notice tone="warn" className="mt-2">OpenSky is unavailable right now: {state.error}</Notice>}
      {state.data && (
        <div className="mt-2 text-sm text-slate-700">
          <p>{state.data.total} aircraft near {state.data.place.name}.</p>
          <ul className="mt-1 grid gap-x-3 sm:grid-cols-2">
            {state.data.aircraft.slice(0, 8).map((a) => (
              <li key={a.icao24} className="tabular-nums">{a.callsign ?? a.icao24} · {a.onGround ? 'on ground' : `${Math.round(a.altitudeM ?? 0).toLocaleString('en-CA')} m`}</li>
            ))}
          </ul>
          <SourceLine source={state.data.source} at={state.data.retrievedAt} />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Aircraft positions show traffic near an airport. They do not identify cargo or prove any shipment is on board.</p>
    </div>
  )
}

const MODE_ICON = { sea: 'ship', air: 'plane', rail: 'train', road: 'truck' }

export default function Shipments() {
  const { ws, model, isDemo, deleteRecord, counts, limit, health } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const [filters, setFilters] = useState({ status: '', mode: '', direction: '', query: '' })
  const [sort, setSort] = useState({ key: 'eta', dir: 1 })
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }))

  // Delay Assist returns here with ?open=<id> so the saved decision is shown straight away.
  const openId = params.get('open')
  useEffect(() => {
    if (!openId) return
    const target = model.shipments.find((s) => s.id === openId)
    if (target) setDetail(target)
    setParams({}, { replace: true })
  }, [openId]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = filters.query.toLowerCase()
    return model.shipments
      .filter((s) => (!filters.status || s.status === filters.status) && (!filters.mode || s.mode === filters.mode) && (!filters.direction || (s.direction ?? 'import') === filters.direction))
      .filter((s) => !q || [s.reference, s.supplier?.name, s.carrier, s.product?.name, s.containerNo, s.awb].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => {
        const [x, y] = [SORTERS[sort.key](a), SORTERS[sort.key](b)]
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
      })
  }, [model, filters, sort])
  const paged = usePaged(rows, 15, JSON.stringify(filters))

  const header = (key, label) => (
    <button type="button" className="inline-flex items-center gap-1 font-semibold uppercase hover:text-navy" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
      {label}
      {sort.key === key && <span aria-hidden="true">{sort.dir > 0 ? '↑' : '↓'}</span>}
    </button>
  )

  const atLimit = counts.shipments >= limit('shipments')
  const needsAction = model.shipments.filter((s) => delayState(s, ws.events) === 'needs_action').length
  const countOf = (status) => model.shipments.filter((s) => s.status === status).length
  const overview = [
    { label: 'All shipments', value: model.shipments.length, status: '', icon: 'box' },
    { label: 'In transit', value: countOf('in_transit') + countOf('at_port'), status: 'in_transit', icon: 'route' },
    { label: 'Delayed', value: countOf('delayed'), status: 'delayed', icon: 'clock', tone: countOf('delayed') ? 'bad' : 'good' },
    { label: 'Needs action', value: needsAction, status: 'delayed', icon: 'alert', tone: needsAction ? 'warn' : 'good' },
    { label: 'Arrived', value: countOf('arrived'), status: 'arrived', icon: 'check' },
  ]
  const filtered = Object.values(filters).some(Boolean)
  const current = detail ? model.shipments.find((s) => s.id === detail.id) ?? detail : null

  const columns = [
    { key: 'reference', sort: sort.key === 'reference' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', header: header('reference', 'Shipment'), render: (s) => (
      <span className="block">
        <span className="font-semibold text-navy">{s.reference}</span>
        <span className="mt-0.5 block text-[0.6875rem] tracking-wide text-slate-500 uppercase">{(s.direction ?? 'import') === 'export' ? 'Export' : 'Import'}{s.product?.name ? ` · ${s.product.name}` : ''}</span>
      </span>
    ) },
    { key: 'party', label: 'Supplier or destination', render: (s) => s.supplier?.name ?? `Export: ${s.legs[s.legs.length - 1]?.to?.name ?? 'Unknown'}` },
    { key: 'mode', label: 'Mode', render: (s) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"><Icon name={MODE_ICON[s.mode] ?? 'route'} className="h-3.5 w-3.5" />{modeLabel(s.mode)}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (s) => {
        const state = delayState(s, ws.events)
        return (
          <span className="flex flex-wrap gap-1">
            <StatusPill tone={STATUS_TONE[s.status] ?? 'slate'}>{statusLabel(s.status)}</StatusPill>
            {state === 'needs_action' && <Badge tone="amber">Needs action</Badge>}
            {state === 'resolved' && <Badge tone="emerald">Resolved</Badge>}
            {s.risk?.level === 'high' && s.status !== 'delayed' && <Badge tone="rose">High route risk</Badge>}
          </span>
        )
      },
    },
    { key: 'eta', sort: sort.key === 'eta' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', header: header('eta', 'ETA'), render: (s) => <span className="whitespace-nowrap">{formatDate(s.eta)}</span> },
    { key: 'cost', sort: sort.key === 'cost' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', header: header('cost', 'Cost'), right: true, render: (s) => (s.costCad == null ? '—' : money(s.costCad)) },
    { key: 'emissions', sort: sort.key === 'emissions' ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none', header: header('emissions', 'Est. CO₂e'), right: true, render: (s) => (s.emissions ? formatCo2e(s.emissions.co2eKg) : '—') },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      render: (s) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label={`Edit ${s.reference}`} onClick={() => setForm(s)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy"><Icon name="edit" className="h-4 w-4" /></button>
          <button type="button" aria-label={`Delete ${s.reference}`} onClick={() => setDeleting(s)} className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Icon name="trash" className="h-4 w-4" /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <CompactPageHeader
        title="Shipments"
        badge={isDemo && <DemoTag />}
        description={`${counts.shipments} of ${limit('shipments').toLocaleString()} shipment records used.${!health?.integrations?.tracking ? ' No tracking provider is configured, so statuses are updated by hand.' : ''}`}
        actions={<>
          <AiLauncher task="Which of my shipments are most at risk right now, and what should I do about them?" context={[`${model.shipments.length} shipments`, `${countOf('delayed')} delayed`, `${needsAction} need action`]} />
          <Button data-tour="add-shipment" disabled={atLimit} onClick={() => setForm({})} title={atLimit ? 'Plan limit reached' : undefined}><Icon name="plus" className="h-4 w-4" /> Add shipment</Button>
        </>}
      />

      {atLimit && <Notice tone="warn">You have reached this plan’s shipment limit. Existing records stay available.</Notice>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {overview.map((o) => {
          const active = filters.status === o.status && (o.label !== 'Needs action') && !!o.status
          return (
            <button key={o.label} type="button" aria-pressed={active} onClick={() => set('status')(active ? '' : o.status)} className={`rounded-xl border px-3 py-2 text-start transition-colors ${active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-200'}`}>
              <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-slate-500 uppercase"><Icon name={o.icon} className="h-3.5 w-3.5" />{o.label}</span>
              <span className={`font-display block text-lg font-bold tabular-nums ${o.tone === 'bad' ? 'text-rose-700' : o.tone === 'warn' ? 'text-amber-700' : 'text-navy'}`}>{o.value}</span>
            </button>
          )
        })}
      </div>

      <Card padded={false} tour="feature-shipments">
        <div className="grid gap-2 border-b border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
          <SearchInput label="Search shipments" placeholder="Reference, supplier, carrier" value={filters.query} onChange={set('query')} />
          <SelectInput label="Status" placeholder="All statuses" value={filters.status} onChange={set('status')} options={SHIPMENT_STATUSES} />
          <SelectInput label="Mode" placeholder="All modes" value={filters.mode} onChange={set('mode')} options={MODES} />
          <SelectInput label="Direction" placeholder="All" value={filters.direction} onChange={set('direction')} options={[{ value: 'import', label: 'Import' }, { value: 'export', label: 'Export' }]} />
          {filtered && <Button size="sm" variant="ghost" onClick={() => setFilters({ status: '', mode: '', direction: '', query: '' })}>Clear</Button>}
        </div>
        <div className="p-1">
          <DataTable
            caption="Shipments"
            columns={columns}
            rows={paged.rows}
            rowKey={(s) => s.id}
            onRowClick={setDetail}
            empty={<div className="p-4"><Empty icon="ship" title={model.shipments.length ? 'No shipments match these filters' : 'No shipments yet'} action={!model.shipments.length && <Button onClick={() => setForm({})}>Add your first shipment</Button>}>Add shipments to see routes, emissions and risk on the map.</Empty></div>}
          />
        </div>
        <div className="px-3 pb-2"><Pager paged={paged} label="Shipment pages" /></div>
      </Card>

      <Card padded>
        <SectionTabs idPrefix="ship-extra" label="Supplementary tools" tabs={[
          { id: 'activity', label: 'Activity feed', content: <BoundedList maxHeight="22rem" label="Activity feed"><ActivityFeed limit={25} onOpenShipment={(id) => setDetail(model.shipments.find((s) => s.id === id) ?? null)} /></BoundedList> },
          { id: 'aircraft', label: 'Live aircraft near airports', content: (
            <div>
              <p className="mb-2 text-xs text-slate-500">Supplementary context from OpenSky Network, loaded when you open this tab.</p>
              <Gate feature="tracking.live"><BoundedList maxHeight="22rem" label="Live aircraft"><AircraftPanel /></BoundedList></Gate>
            </div>
          ) },
        ]} />
      </Card>

      {form && <ShipmentForm open shipment={form} onClose={() => setForm(null)} />}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={current ? `Shipment ${current.reference}` : 'Shipment details'} subtitle={current ? `${modeLabel(current.mode)} · ${statusLabel(current.status)}` : undefined} size="md"
        footer={current && <>
          <AiLauncher task={`Investigate risks for shipment ${current.reference}.`} context={[`Shipment ${current.reference}`, `Mode: ${modeLabel(current.mode)}`, `Status: ${statusLabel(current.status)}`, `ETA: ${current.eta ?? 'unknown'}`]} />
          <Button size="sm" variant="secondary" onClick={() => { setForm(current); setDetail(null) }}><Icon name="edit" className="h-4 w-4" /> Edit</Button>
        </>}>
        {current && <ShipmentDetail shipment={current} />}
      </Drawer>
      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete shipment"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await deleteRecord('shipments', deleting.id)
          toast(`${deleting.reference} deleted`)
          setDeleting(null)
        }}
      >
        Delete {deleting?.reference}? This cannot be undone.
      </ConfirmModal>
    </div>
  )
}
