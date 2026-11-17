import { useState } from 'react'
import AiPreferences from '../../components/app/AiPreferences.jsx'
import Integrations from './Integrations.jsx'
import { AccessibilitySettings } from '../../components/app/Accessibility.jsx'
import { SETTINGS_TABS } from '../../help/topics.js'
import { Link, useSearchParams } from 'react-router-dom'
import { formatCo2e } from '../../../shared/emissions.js'
import { PLANS, PLAN_ORDER } from '../../../shared/entitlements.js'
import { FinanceEditor, INDUSTRIES, PROVINCES, ProductEditor, SupplierCsvImport, SupplierEditor, locateCanadianPlace, locateSupplier } from '../../components/app/companyForms.jsx'
import { Card, ConfirmModal, DataTable, DemoTag, Empty, Gate, Notice, NumberInput, PageHeader, Segmented, SelectInput, TextInput, useToast } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { DEMO_TEAM } from '../../data/demoCompanies.js'
import { aggregateEmissions } from '../../engine/model.js'
import { supabase } from '../../services/supabase.js'
import { FEATURES, SECTIONS, VEHICLES, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money, percent } from '../../utils/format.js'

function ProfileTab() {
  const { ws, updateCompany } = useWorkspace()
  const toast = useToast()
  const [c, setC] = useState({ name: ws.company.name, industry: ws.company.industry ?? '', city: ws.company.hq?.city ?? '', province: ws.company.hq?.province ?? '', inventoryDays: ws.company.operations?.inventoryDays ?? '', leadTimeDays: ws.company.operations?.leadTimeDays ?? '', dailyShortfallCost: ws.company.operations?.dailyShortfallCost ?? '' })
  const set = (key) => (value) => setC((x) => ({ ...x, [key]: value }))

  const save = async (e) => {
    e.preventDefault()
    if (!c.name.trim()) return toast('Company name is required', 'error')
    const moved = c.city !== ws.company.hq?.city || c.province !== ws.company.hq?.province
    const hq = moved ? { city: c.city, province: c.province, ...(await locateCanadianPlace(c.city, c.province)) } : ws.company.hq
    await updateCompany({ name: c.name.trim(), industry: c.industry, hq, operations: { ...ws.company.operations, inventoryDays: c.inventoryDays, leadTimeDays: c.leadTimeDays, dailyShortfallCost: c.dailyShortfallCost } })
    toast('Company profile saved')
  }

  return (
    <Card>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextInput label="Company name" value={c.name} onChange={set('name')} />
        <SelectInput label="Industry" value={c.industry} onChange={set('industry')} options={INDUSTRIES} />
        <TextInput label="Headquarters city" value={c.city} onChange={set('city')} />
        <SelectInput label="Province" value={c.province} onChange={set('province')} options={PROVINCES} />
        <NumberInput label="Inventory coverage (days)" optional value={c.inventoryDays} onChange={set('inventoryDays')} />
        <NumberInput label="Typical lead time (days)" optional value={c.leadTimeDays} onChange={set('leadTimeDays')} />
        <NumberInput label="Cost per shortfall day (CAD)" optional value={c.dailyShortfallCost} onChange={set('dailyShortfallCost')} />
        <div className="flex items-end"><Button type="submit">Save profile</Button></div>
      </form>
    </Card>
  )
}

function ProductsTab() {
  const { ws, saveRecord, deleteRecord } = useWorkspace()
  const toast = useToast()
  const [drafts, setDrafts] = useState({})
  const [deleting, setDeleting] = useState(null)
  const update = (p) => (next) => setDrafts((d) => ({ ...d, [p.id]: { ...(d[p.id] ?? p), ...next } }))
  const add = async () => {
    await saveRecord('products', { id: crypto.randomUUID(), name: 'New product', category: '', hsCode: '', hsStatus: 'unverified' })
  }
  const save = async (p) => {
    await saveRecord('products', drafts[p.id] ?? p)
    toast('Product saved')
  }
  return (
    <div className="space-y-3">
      {ws.products.map((p, i) => (
        <div key={p.id}>
          <ProductEditor product={drafts[p.id] ?? p} index={i} industry={ws.company.industry} onChange={update(p)} onRemove={() => setDeleting(p)} />
          <Button size="sm" className="mt-1" onClick={() => save(p)}>Save product</Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add}><Icon name="plus" className="h-4 w-4" /> Add product</Button>
      <ConfirmModal open={Boolean(deleting)} title="Delete product" onClose={() => setDeleting(null)} onConfirm={async () => { await deleteRecord('products', deleting.id); setDeleting(null) }}>
        Delete {deleting?.name}?
      </ConfirmModal>
    </div>
  )
}

function SuppliersTab() {
  const { ws, saveRecord, deleteRecord, counts, limit, session } = useWorkspace()
  const toast = useToast()
  const [drafts, setDrafts] = useState({})
  const [deleting, setDeleting] = useState(null)
  const atLimit = counts.suppliers >= limit('suppliers')
  const update = (s) => (next) => setDrafts((d) => ({ ...d, [s.id]: { ...(d[s.id] ?? s), ...next } }))

  const add = async (row = {}) => {
    try {
      const id = crypto.randomUUID()
      await saveRecord('suppliers', { id, name: 'New supplier', country: '', currency: 'CAD', mode: 'sea', productIds: [], certifications: [], compliance: {}, ...row })
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const save = async (s) => {
    const draft = drafts[s.id] ?? s
    if (!draft.name?.trim() || !draft.country) return toast('A supplier needs a name and a country', 'error')
    await saveRecord('suppliers', await locateSupplier(draft))
    toast('Supplier saved')
  }

  const upload = async (s, file) => {
    if (!file) return
    const { error } = await supabase.storage.from('compliance-documents').upload(`${ws.company.id}/${s.id}/${file.name}`, file, { upsert: true })
    toast(error ? `Upload failed: ${error.message}` : 'Document uploaded', error ? 'error' : 'good')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{counts.suppliers} of {limit('suppliers').toLocaleString('en-CA')} suppliers used.</p>
        <div className="flex gap-2">
          <SupplierCsvImport onImport={async (rows) => { for (const row of rows) await add(row) }} />
          <Button size="sm" disabled={atLimit} onClick={() => add()}><Icon name="plus" className="h-4 w-4" /> Add supplier</Button>
        </div>
      </div>
      {atLimit && <Notice tone="warn">You have reached this plan’s supplier limit. Existing suppliers stay available and editable.</Notice>}
      {ws.suppliers.map((s, i) => (
        <div key={s.id}>
          <SupplierEditor supplier={drafts[s.id] ?? s} index={i} products={ws.products} warehouses={ws.warehouses} onChange={update(s)} onRemove={() => setDeleting(s)} showCompliance />
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => save(s)}>Save supplier</Button>
            {session?.mode === 'supabase' ? (
              <label className="text-sm text-brand-800 underline">Upload document<input type="file" className="sr-only" onChange={(e) => upload(s, e.target.files?.[0])} /></label>
            ) : (
              <span className="text-xs text-slate-500">Document uploads need secure storage, which requires a configured account backend.</span>
            )}
          </div>
        </div>
      ))}
      {!ws.suppliers.length && <Empty icon="building" title="No suppliers yet">Add a supplier or import a CSV.</Empty>}
      <ConfirmModal open={Boolean(deleting)} title="Delete supplier" onClose={() => setDeleting(null)} onConfirm={async () => { await deleteRecord('suppliers', deleting.id); setDeleting(null) }}>
        Delete {deleting?.name || 'this supplier'}? Linked shipments keep their records but lose the supplier link.
      </ConfirmModal>
    </div>
  )
}

function WarehousesTab() {
  const { ws, saveRecord, deleteRecord } = useWorkspace()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', city: '', province: 'ON' })
  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast('Enter a warehouse name', 'error')
    await saveRecord('warehouses', { id: crypto.randomUUID(), ...form, ...(await locateCanadianPlace(form.city, form.province)) })
    setForm({ name: '', city: '', province: 'ON' })
    toast('Warehouse added')
  }
  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {ws.warehouses.map((w) => (
          <li key={w.id} className="flex items-center justify-between py-2 text-sm">
            <span><strong className="text-navy">{w.name}</strong> · {[w.city, w.province].filter(Boolean).join(', ')}</span>
            <button type="button" aria-label={`Delete ${w.name}`} onClick={() => deleteRecord('warehouses', w.id)} className="rounded p-1 text-slate-500 hover:text-rose-700"><Icon name="trash" className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-4">
        <TextInput label="Warehouse name" value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} />
        <TextInput label="City" value={form.city} onChange={(city) => setForm((f) => ({ ...f, city }))} />
        <SelectInput label="Province" placeholder={null} value={form.province} onChange={(province) => setForm((f) => ({ ...f, province }))} options={PROVINCES} />
        <div className="flex items-end"><Button type="submit" variant="secondary">Add warehouse</Button></div>
      </form>
    </Card>
  )
}

function FinanceTab() {
  const { ws, updateCompany, fx } = useWorkspace()
  const toast = useToast()
  const [finance, setFinance] = useState(ws.company.finance ?? {})
  return (
    <Card>
      <FinanceEditor finance={finance} company={ws.company} onChange={(next) => setFinance((f) => ({ ...f, ...next }))} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={async () => { await updateCompany({ finance }); toast('Financial inputs saved') }}>Save financials</Button>
        <span className="text-xs text-slate-500">Exchange rates: {fx.source}{fx.asOf ? `, as of ${fx.asOf}` : ''}</span>
      </div>
    </Card>
  )
}

function TeamTab() {
  const { isDemo, session, plan, limit } = useWorkspace()
  const real = session?.mode === 'supabase'
  const members = isDemo ? DEMO_TEAM.slice(0, plan === 'enterprise' ? 4 : 2) : []
  return (
    <Gate feature="team.limited">
      <Card title="Team" subtitle={`${limit('seats')} seats on this plan`}>
        {isDemo && <Notice tone="info" className="mb-3">Team members here are fictional. Demo mode has no real accounts.</Notice>}
        {!isDemo && !real && <Notice tone="warn" className="mb-3">Team collaboration needs the account backend. Local workspaces are single-browser.</Notice>}
        {members.length > 0 && (
          <DataTable caption="Team members" rowKey={(m) => m.email} rows={members} columns={[{ key: 'name', label: 'Name', render: (m) => m.name }, { key: 'role', label: 'Role', render: (m) => <Badge tone="slate">{m.role}</Badge> }, { key: 'email', label: 'Email', render: (m) => m.email }]} />
        )}
        {real && <p className="text-sm text-slate-600">Roles are enforced by database row-level security: owners and admins manage the company, members edit records, and viewers can only read. Add members through your Supabase project until invitations are built.</p>}
      </Card>
    </Gate>
  )
}

const INTEGRATION_POINTS = [
  ['ERP connector', 'Configurable integration point. Not connected.'],
  ['Purchase-order import', 'CSV import is available for suppliers. API import is a planned integration point.'],
  ['Outbound reporting API', 'Configurable integration point. Not live.'],
  ['Container and air waybill tracking', 'Adapter seam exists at /api/tracking/lookup. No provider is connected.'],
]

function AdminTab() {
  const { model, ws, health, counts, limit } = useWorkspace()
  const locations = model.warehouses.map((w) => {
    const shipments = model.shipments.filter((s) => s.warehouseId === w.id)
    const suppliers = model.suppliers.filter((s) => s.warehouseId === w.id)
    return { ...w, shipments: shipments.length, share: suppliers.reduce((sum, s) => sum + s.share, 0), co2e: aggregateEmissions(shipments).totalKg, freight: shipments.reduce((sum, s) => sum + (s.costCad ?? 0), 0) }
  })
  const usage = [['Suppliers', counts.suppliers, limit('suppliers')], ['Shipments', counts.shipments, limit('shipments')], ['Scenarios', counts.scenarios, limit('scenarios')], ['Reports', counts.reports, limit('reports')]]
  const on = health?.integrations ?? {}
  return (
    <Gate feature="admin.dashboard">
      <div className="space-y-4">
        <Card title="Administrative dashboard">
          <div className="grid gap-3 sm:grid-cols-4">
            {usage.map(([label, used, max]) => (
              <div key={label}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="font-display text-lg font-bold text-navy tabular-nums">{used.toLocaleString('en-CA')} <span className="text-sm font-normal text-slate-500">/ {max.toLocaleString('en-CA')}</span></p>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-brand-700" style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Multi-location analysis" subtitle="Recorded shipments and sourcing share by receiving location">
          <Gate feature="multilocation">
            <DataTable
              caption="Locations"
              rowKey={(l) => l.id}
              rows={locations}
              columns={[
                { key: 'name', label: 'Location', render: (l) => <span className="font-semibold text-navy">{l.name}</span> },
                { key: 'shipments', label: 'Shipments', right: true, render: (l) => l.shipments },
                { key: 'share', label: 'Sourcing share', right: true, render: (l) => percent(l.share, 0) },
                { key: 'freight', label: 'Recorded freight', right: true, render: (l) => money(l.freight) },
                { key: 'co2e', label: 'Est. transport CO₂e', right: true, render: (l) => formatCo2e(l.co2e) },
              ]}
            />
          </Gate>
        </Card>
        <Card title="Integrations" subtitle="Current status, reported by the server">
          <ul className="divide-y divide-slate-100 text-sm">
            {[['Climatiq', on.climatiq], ['Supabase accounts', on.supabase], ['AI explanations', on.ai], ['Tracking provider', on.tracking]].map(([name, active]) => (
              <li key={name} className="flex justify-between py-1.5"><span>{name}</span><Badge tone={active ? 'emerald' : 'slate'}>{active ? 'Configured' : 'Not configured'}</Badge></li>
            ))}
            {INTEGRATION_POINTS.map(([name, status]) => (
              <li key={name} className="flex flex-wrap justify-between gap-x-3 py-1.5"><span>{name}</span><span className="text-slate-500">{status}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Organization-wide sustainability" subtitle="All locations, same boundary as the Sustainability page">
          <p className="text-sm text-slate-700">{formatCo2e(model.emissions.totalKg)} estimated transport CO₂e across {ws.warehouses.length} location(s) and {model.emissions.shipmentCount} shipment(s).</p>
        </Card>
      </div>
    </Gate>
  )
}

function PlanTab() {
  const { plan, isDemo, isLocal, setDemoTier, updateCompany, resetDemo, session } = useWorkspace()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <Card title="Plan">
      <p className="text-sm text-slate-700">Current plan: <strong>{PLANS[plan].name}</strong>. {PLANS[plan].tagline}</p>
      {(isDemo || isLocal) && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-navy">Preview a tier</p>
          <Segmented label="Preview tier" value={plan} onChange={(next) => (isDemo ? setDemoTier(next) : updateCompany({ plan: next }))} options={PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].name }))} />
          <p className="mt-1 text-xs text-slate-500">This only simulates access. No billing or subscription changes. Downgrading keeps your data and restricts new additions.</p>
        </div>
      )}
      {session?.mode === 'supabase' && <p className="mt-2 text-sm text-slate-600">Plans cannot be changed from the app because billing is not available yet.</p>}
      <Link to="/pricing" className="mt-3 inline-block text-sm font-semibold text-brand-800 hover:underline">View plan comparison</Link>
      {isDemo && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)}><Icon name="refresh" className="h-4 w-4" /> Reset demo data</Button>
        </div>
      )}
      <ConfirmModal open={confirmReset} title="Reset demo data" confirmLabel="Reset" onClose={() => setConfirmReset(false)} onConfirm={async () => { await resetDemo(); setConfirmReset(false); toast('Demo data restored') }}>
        Discard your changes to this fictional company?
      </ConfirmModal>
    </Card>
  )
}

function Toggle({ label, blurb, checked, onChange, icon }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2.5">
      {icon && (
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${checked ? 'bg-brand-100 text-brand-300' : 'bg-slate-100 text-slate-500'}`}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-navy">{label}</span>
        <span className="block text-xs text-slate-500">{blurb}</span>
      </span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ${checked ? 'bg-brand-700' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </label>
  )
}

function DisplayTab() {
  const { health } = useWorkspace()
  const { prefs, setFeature, setSection, setVehicle, setTheme, reset } = useViewPrefs()
  const toast = useToast()
  const on = health?.integrations ?? {}
  const needs = { activity: 'shipments' }
  return (
    <div className="space-y-3">
      <Card title="Theme" subtitle="How the workspace looks. The sun and moon button in the top bar does the same.">
        <Segmented label="Theme" value={prefs.theme} onChange={setTheme} options={[{ value: 'dark', label: 'Dark (purple)' }, { value: 'light', label: 'Light' }]} />
      </Card>
      <AccessibilitySettings />
      <Notice tone="info">These choices change what this browser shows. They are saved here only, and they never delete data or change your plan.</Notice>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Features" subtitle="Turning a feature off hides its tile, its menu entry and its page.">
          <div className="divide-y divide-slate-100">
            {FEATURES.map((f) => (
              <Toggle key={f.id} icon={f.icon} label={f.label} blurb={f.blurb} checked={prefs.features[f.id]} onChange={(v) => setFeature(f.id, v)} />
            ))}
          </div>
        </Card>
        <div className="space-y-3">
          <Card title="Command Center sections" subtitle="Choose the blocks shown on the main screen.">
            <div className="divide-y divide-slate-100">
              {SECTIONS.map((s) => {
                const blocked = needs[s.id] && !prefs.features[needs[s.id]]
                return <Toggle key={s.id} label={s.label} blurb={blocked ? `Hidden while ${FEATURES.find((f) => f.id === needs[s.id]).label} is off.` : s.blurb} checked={prefs.sections[s.id]} onChange={(v) => setSection(s.id, v)} />
              })}
            </div>
          </Card>
          <Card title="Hero vehicle" subtitle="The 3D model shown in the hero scene. It can also be changed on the Command Center.">
            <div data-tour="display-vehicle"><Segmented label="Hero vehicle" value={prefs.vehicle} onChange={setVehicle} options={VEHICLES.map((v) => ({ value: v.id, label: v.label }))} /></div>
          </Card>
          <Card title="Integrations" subtitle="Current status, reported by the server">
            {health === null ? (
              <p className="text-sm text-slate-600">Checking…</p>
            ) : health.ok === false ? (
              <p className="text-sm text-slate-600">API offline: using local fallbacks.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {[['Emissions API', on.climatiq], ['Accounts', on.supabase], ['AI text', on.ai], ['Tracking', on.tracking]].map(([name, active]) => (
                  <li key={name} className="flex justify-between py-1.5"><span>{name}</span><Badge tone={active ? 'emerald' : 'slate'}>{active ? 'Configured' : 'Not configured'}</Badge></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => { reset(); toast('Display settings restored') }}><Icon name="refresh" className="h-4 w-4" /> Restore defaults</Button>
    </div>
  )
}

// Settings are grouped by what they are about, so eleven tabs read as three short lists.
const SETTINGS_GROUPS = [
  { label: 'Company', tabs: [
    { id: 'profile', label: 'Profile', icon: 'building' },
    { id: 'products', label: 'Products', icon: 'box' },
    { id: 'suppliers', label: 'Suppliers', icon: 'users' },
    { id: 'warehouses', label: 'Warehouses', icon: 'pin' },
    { id: 'financials', label: 'Financials', icon: 'card' },
  ] },
  { label: 'AI and data', tabs: [
    { id: 'ai', label: 'AI', icon: 'sparkles' },
    { id: 'integrations', label: 'Integrations', icon: 'layers' },
  ] },
  { label: 'Workspace', tabs: [
    { id: 'display', label: 'Display', icon: 'settings' },
    { id: 'team', label: 'Team', icon: 'user' },
    { id: 'plan', label: 'Plan', icon: 'tag' },
    { id: 'admin', label: 'Admin', icon: 'shield' },
  ] },
]
const ALL_TABS = SETTINGS_GROUPS.flatMap((g) => g.tabs)
const TAB_BLURBS = {
  profile: 'Your company name, location and operating figures.',
  products: 'What you buy and sell, with HS codes.',
  suppliers: 'Supplier records, lanes and documentation.',
  warehouses: 'Where shipments are delivered.',
  financials: 'Spending figures used in every calculation.',
  ai: 'Connect AI models and choose what they may see.',
  display: 'Theme, text size, and which features are shown.',
  team: 'Who can use this workspace.',
  plan: 'Your plan and its limits.',
  admin: 'Usage, records and workspace status.',
}

/** A sidebar on wide screens and a scrolling strip on narrow ones. One tablist either way. */
function SettingsNav({ active, onChange }) {
  const move = (e) => {
    const index = ALL_TABS.findIndex((t) => t.id === active)
    const next = ['ArrowDown', 'ArrowRight'].includes(e.key) ? (index + 1) % ALL_TABS.length : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? (index + ALL_TABS.length - 1) % ALL_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? ALL_TABS.length - 1 : null
    if (next === null) return
    e.preventDefault()
    onChange(ALL_TABS[next].id)
    e.currentTarget.querySelectorAll('[role="tab"]')[next].focus()
  }
  return (
    <div role="tablist" aria-label="Settings sections" onKeyDown={move} className="wm-strip mb-4 flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:mb-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-2xl wm-sidenav lg:border lg:border-slate-200 lg:p-2">
      {SETTINGS_GROUPS.map((group, g) => (
        <div key={group.label} role="presentation" className={`flex shrink-0 gap-1 lg:flex-col lg:gap-0.5 ${g ? 'border-l border-slate-200 pl-1 lg:mt-2 lg:border-t lg:border-l-0 lg:pt-2 lg:pl-0' : ''}`}>
          <p aria-hidden="true" className="hidden px-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wider text-slate-500 uppercase lg:block">{group.label}</p>
          {group.tabs.map((t) => {
            const on = active === t.id
            return (
              <button
                key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors ${on ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100 hover:text-navy'}`}
              >
                <Icon name={t.icon} className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default function Settings() {
  const { isDemo } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const tab = SETTINGS_TABS.includes(params.get('tab')) ? params.get('tab') : 'profile'
  const setTab = (value) => setParams({ tab: value })
  const current = ALL_TABS.find((t) => t.id === tab)
  return (
    <div>
      <Link to="/app" className="mb-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-800 hover:underline"><Icon name="arrowLeft" className="h-4 w-4" /> Back to Command Center</Link>
      <PageHeader title="Company Settings" badge={isDemo && <DemoTag />}>Edit your company, records and plan, and choose which features are shown. Changes update every screen.</PageHeader>
      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-5">
        <SettingsNav active={tab} onChange={setTab} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} data-tour={`settings-${tab}`} className="min-w-0">
          {TAB_BLURBS[tab] && (
            <div className="mb-3">
              <h2 className="text-lg font-bold text-navy">{current.label}</h2>
              <p className="text-sm text-slate-600">{TAB_BLURBS[tab]}</p>
            </div>
          )}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'ai' && <AiPreferences />}
          {tab === 'integrations' && <Integrations embedded />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'products' && <ProductsTab />}
          {tab === 'suppliers' && <SuppliersTab />}
          {tab === 'warehouses' && <WarehousesTab />}
          {tab === 'financials' && <FinanceTab />}
          {tab === 'team' && <TeamTab />}
          {tab === 'admin' && <AdminTab />}
          {tab === 'plan' && <PlanTab />}
        </div>
      </div>
    </div>
  )
}
