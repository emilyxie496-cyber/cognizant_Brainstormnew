import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AiPreferences from '../../components/app/AiPreferences.jsx'
import { AccessibilitySettings } from '../../components/app/Accessibility.jsx'
import { SETTINGS_TABS } from '../../help/topics.js'
import { formatCo2e } from '../../../shared/emissions.js'
import { PLANS, PLAN_ORDER } from '../../../shared/entitlements.js'
import { FinanceEditor, INDUSTRIES, PROVINCES, locateCanadianPlace } from '../../components/app/companyForms.jsx'
import { Card, CompactPageHeader, ConfirmModal, DataTable, DemoTag, Gate, Notice, NumberInput, Segmented, SelectInput, TextInput, useToast } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { DEMO_TEAM } from '../../data/demoCompanies.js'
import { aggregateEmissions } from '../../engine/model.js'
import { useTranslation } from '../../i18n/index.js'
import { FEATURES, SECTIONS, VEHICLES, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money, percent } from '../../utils/format.js'
import BrandingTab from './settings/BrandingTab.jsx'
import FeaturesTab, { Switch } from './settings/FeaturesTab.jsx'
import { EmailTab, IntegrationsSummary, LanguageTab } from './settings/PlatformTabs.jsx'
import { ProductsTab, SuppliersTab } from './settings/RecordsTabs.jsx'

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

function DisplayTab() {
  const { t } = useTranslation()
  const { prefs, setSection, setVehicle, setTheme, reset } = useViewPrefs()
  const toast = useToast()
  const needs = { activity: 'shipments' }
  return (
    <div className="space-y-3">
      <Card title={t('display.theme')} subtitle="The sun and moon button in the top bar does the same.">
        <Segmented label={t('display.theme')} value={prefs.theme} onChange={setTheme} options={[{ value: 'dark', label: t('display.dark') }, { value: 'light', label: t('display.light') }]} />
      </Card>
      <AccessibilitySettings />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={t('display.sections')} subtitle={t('display.sectionsHelp')}>
          <div className="divide-y divide-slate-100">
            {SECTIONS.map((s) => {
              const blocked = needs[s.id] && !prefs.features[needs[s.id]]
              return (
                <label key={s.id} className="flex cursor-pointer items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy">{s.label}</span><span className="block text-xs text-slate-500">{blocked ? `Hidden while ${FEATURES.find((f) => f.id === needs[s.id]).label} is off.` : s.blurb}</span></span>
                  <Switch label={s.label} checked={prefs.sections[s.id]} onChange={(v) => setSection(s.id, v)} />
                </label>
              )
            })}
          </div>
        </Card>
        <Card title={t('display.vehicle')} subtitle={t('display.vehicleHelp')}>
          <div data-tour="display-vehicle"><Segmented label={t('display.vehicle')} value={prefs.vehicle} onChange={setVehicle} options={VEHICLES.map((v) => ({ value: v.id, label: v.label }))} /></div>
          <p className="mt-3 text-xs text-slate-500">{t('display.localNote')}</p>
        </Card>
      </div>
      <Button variant="secondary" size="sm" onClick={() => { reset(); toast('Display settings restored') }}><Icon name="refresh" className="h-4 w-4" /> {t('actions.restoreDefaults')}</Button>
    </div>
  )
}

// Grouped by what they are about: company records, platform capabilities, and this workspace.
const SETTINGS_GROUPS = [
  { id: 'company', tabs: [
    { id: 'profile', icon: 'building' },
    { id: 'branding', icon: 'image' },
    { id: 'products', icon: 'box' },
    { id: 'suppliers', icon: 'users' },
    { id: 'warehouses', icon: 'pin' },
    { id: 'financials', icon: 'card' },
  ] },
  { id: 'platform', tabs: [
    { id: 'features', icon: 'layers' },
    { id: 'ai', icon: 'sparkles' },
    { id: 'integrations', icon: 'route' },
    { id: 'email', icon: 'mail' },
  ] },
  { id: 'workspace', tabs: [
    { id: 'display', icon: 'settings' },
    { id: 'language', icon: 'languages' },
    { id: 'team', icon: 'user' },
    { id: 'plan', icon: 'tag' },
    { id: 'admin', icon: 'shield' },
  ] },
]
const ALL_TABS = SETTINGS_GROUPS.flatMap((g) => g.tabs)

/** A sidebar on wide screens and a scrolling strip on narrow ones. One tablist either way. */
function SettingsNav({ active, onChange }) {
  const { t } = useTranslation()
  const move = (e) => {
    const index = ALL_TABS.findIndex((x) => x.id === active)
    const rtl = document.documentElement.dir === 'rtl'
    const fwd = ['ArrowDown', rtl ? 'ArrowLeft' : 'ArrowRight']
    const back = ['ArrowUp', rtl ? 'ArrowRight' : 'ArrowLeft']
    const next = fwd.includes(e.key) ? (index + 1) % ALL_TABS.length : back.includes(e.key) ? (index + ALL_TABS.length - 1) % ALL_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? ALL_TABS.length - 1 : null
    if (next === null) return
    e.preventDefault()
    onChange(ALL_TABS[next].id)
    e.currentTarget.querySelectorAll('[role="tab"]')[next].focus()
  }
  return (
    <div role="tablist" aria-label={t('settings.title')} aria-orientation="vertical" onKeyDown={move} className="wm-strip wm-sidenav mb-4 flex gap-1 overflow-x-auto lg:sticky lg:top-32 lg:mb-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-2xl lg:border lg:border-slate-200 lg:p-2">
      {SETTINGS_GROUPS.map((group, g) => (
        <div key={group.id} role="presentation" className={`flex shrink-0 gap-1 lg:flex-col lg:gap-0.5 ${g ? 'border-s border-slate-200 ps-1 lg:mt-2 lg:border-t lg:border-s-0 lg:pt-2 lg:ps-0' : ''}`}>
          <p aria-hidden="true" className="hidden px-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wider text-slate-500 uppercase lg:block">{t(`settings.groups.${group.id}`)}</p>
          {group.tabs.map((tab) => {
            const on = active === tab.id
            return (
              <button key={tab.id} type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(tab.id)}
                className={`flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm font-medium whitespace-nowrap transition-colors ${on ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100 hover:text-navy'}`}>
                <Icon name={tab.icon} className="h-4 w-4 shrink-0" />
                {t(`settings.tabs.${tab.id}`)}
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
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = SETTINGS_TABS.includes(params.get('tab')) ? params.get('tab') : 'profile'
  const setTab = (value) => setParams({ tab: value })
  return (
    <div>
      <Link to="/app" className="mb-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-800 hover:underline"><Icon name="arrowLeft" className="h-4 w-4 rtl:rotate-180" /> {t('settings.back')}</Link>
      <CompactPageHeader title={t('settings.title')} badge={isDemo && <DemoTag />} description={t('settings.subtitle')} />
      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-5">
        <SettingsNav active={tab} onChange={setTab} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} data-tour={`settings-${tab}`} className="min-w-0">
          <div className="mb-3">
            <h2 className="text-lg font-bold text-navy">{t(`settings.tabs.${tab}`)}</h2>
            <p className="text-sm text-slate-600">{t(`settings.blurbs.${tab}`)}</p>
          </div>
          {tab === 'profile' && <ProfileTab />}
          {tab === 'branding' && <BrandingTab />}
          {tab === 'products' && <ProductsTab />}
          {tab === 'suppliers' && <SuppliersTab />}
          {tab === 'warehouses' && <WarehousesTab />}
          {tab === 'financials' && <FinanceTab />}
          {tab === 'features' && <FeaturesTab />}
          {tab === 'ai' && <AiPreferences />}
          {tab === 'integrations' && <IntegrationsSummary />}
          {tab === 'email' && <EmailTab />}
          {tab === 'display' && <DisplayTab />}
          {tab === 'language' && <LanguageTab />}
          {tab === 'team' && <TeamTab />}
          {tab === 'plan' && <PlanTab />}
          {tab === 'admin' && <AdminTab />}
        </div>
      </div>
    </div>
  )
}
