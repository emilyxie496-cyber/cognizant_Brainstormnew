import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { formatCo2e } from '../../../shared/emissions.js'
import { checkLimit } from '../../../shared/entitlements.js'
import ActivityFeed from '../../components/app/ActivityFeed.jsx'
import AnalyzeButton from '../../components/app/AnalyzeButton.jsx'
import CommandHero from '../../components/app/CommandHero.jsx'
import { DemoTag, MethodTag, Modal, Notice, ProvenanceTag, formatDate } from '../../components/app/kit.jsx'
import ShipmentDetail from '../../components/app/ShipmentDetail.jsx'
import { Icon, LevelChip } from '../../components/ui.jsx'
import { delayDecision } from '../../engine/delayPlan.js'
import { FEATURES, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { moneyCompact } from '../../utils/format.js'

/** Real recorded emissions by month. Nothing is drawn without at least two months of data. */
function Sparkline({ rows }) {
  if (rows.length < 2) return null
  const max = Math.max(...rows.map((r) => r.kg)) || 1
  const points = rows.map((r, i) => `${(i / (rows.length - 1)) * 100},${28 - (r.kg / max) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-7 w-full" role="img" aria-label={`Recorded transport emissions by month: ${rows.map((r) => `${r.name ?? r.month}: ${formatCo2e(r.kg)}`).join('; ')}`}>
      <polyline points={points} fill="none" stroke="#8b7bff" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="mt-6 mb-3 text-lg font-bold text-navy">
      {children}
      <span aria-hidden="true" className="mt-1.5 block h-0.5 w-9 rounded-full bg-brand-600" />
    </h2>
  )
}

const TONES = { default: 'bg-brand-100 text-brand-300', good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', bad: 'bg-rose-50 text-rose-700' }

/** A metric tile: round icon, label, then a large figure. */
function Kpi({ label, value, sub, icon, tone = 'default', tag }) {
  return (
    <div className="wm-tile flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`}>
            <Icon name={icon} className="h-[18px] w-[18px]" />
          </span>
        )}
        <p className="text-xs leading-tight font-semibold tracking-wide text-slate-600 uppercase">{label}</p>
      </div>
      <p className="font-display mt-2 truncate text-3xl font-extrabold text-navy tabular-nums" title={typeof value === 'string' ? value : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      {tag && <div className="mt-1.5">{tag}</div>}
    </div>
  )
}

function FeatureTile({ to, label, icon, blurb }) {
  return (
    <Link to={to} aria-label={label} className="wm-tile group flex min-w-0 items-start gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-300">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold tracking-wide text-navy uppercase">{label}</span>
        <span className="mt-1 block text-sm text-slate-600">{blurb}</span>
      </span>
      <Icon name="arrowRight" className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-300" />
    </Link>
  )
}

/** A compact card whose heading stays put while its body scrolls on its own. */
function FeedCard({ id, title, subtitle, count, children }) {
  return (
    <section id={id} data-tour={id === 'alerts' ? 'risk-feed' : undefined} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-bold text-navy">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {count != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 tabular-nums">{count}</span>}
      </div>
      <div className="wm-scroll max-h-72 overflow-y-auto overscroll-contain px-4 py-3" tabIndex={0} role="region" aria-label={`${title}, scrollable`}>
        {children}
      </div>
    </section>
  )
}

function RiskFeed({ onOpenShipment }) {
  const { ws, model } = useWorkspace()
  const { prefs } = useViewPrefs()
  if (!model.alerts.length) return <p className="text-sm text-slate-600">No alerts. Add suppliers and shipments to see indicators.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {model.alerts.map((a) => {
        const shipment = a.shipmentId ? model.shipments.find((s) => s.id === a.shipmentId) : null
        const isDelay = a.id.startsWith('delay-') && shipment
        const decision = isDelay ? delayDecision(ws.events, shipment.id) : null
        // The time shown is the recorded delay event. Rule-based alerts are recalculated live and have no timestamp.
        const since = isDelay ? (ws.events ?? []).filter((e) => e.shipmentId === shipment.id && e.type === 'delayed').sort((x, y) => y.at.localeCompare(x.at))[0]?.at : null
        return (
          <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold text-navy">{a.title}</p>
              <LevelChip level={a.level} />
            </div>
            <p className="mt-0.5 text-sm text-slate-600">{a.detail}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
              {shipment && <button type="button" onClick={() => onOpenShipment(shipment.id)} className="font-semibold text-brand-800 hover:underline">{shipment.reference}{shipment.supplier ? ` · ${shipment.supplier.name}` : ''}</button>}
              <span>{since ? `Recorded ${formatDate(since)}` : 'Current, recalculated live'}</span>
              <span className="ml-auto flex flex-wrap gap-1.5">
                {isDelay && prefs.features.shipments && (
                  <Link data-tour="delay-resolve" to={`/app/shipments/${shipment.id}/resolve`} className="inline-flex min-h-8 items-center rounded-lg bg-brand-700 px-2.5 py-1 text-sm font-semibold text-white hover:bg-brand-600">
                    {decision ? 'Review' : 'Resolve'}
                  </Link>
                )}
                <AnalyzeButton type="alert" id={a.id} compact label={`Analyze ${a.title} with AI`} className="min-h-8" />
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function Overview() {
  const { model, isDemo, plan, counts, fx } = useWorkspace()
  const { prefs } = useViewPrefs()
  const { hash } = useLocation()
  const [selected, setSelected] = useState(null)
  const m = model.metrics
  const prov = model.resolved.provenance
  const shipment = selected ? model.shipments.find((s) => s.id === selected) : null

  const show = prefs.sections
  const showActivity = show.activity && prefs.features.shipments
  const tiles = FEATURES.filter((f) => prefs.features[f.id])
  const nothingShown = !Object.values(show).some(Boolean)

  const overSuppliers = checkLimit(plan, 'suppliers', counts.suppliers, 0)
  const overShipments = checkLimit(plan, 'shipments', counts.shipments, 0)

  useEffect(() => {
    if (hash === '#alerts') document.getElementById('alerts')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [hash])

  return (
    <div>
      {show.hero ? (
        <CommandHero onOpenShipment={setSelected} />
      ) : (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 tabIndex={-1} className="wm-hero-title text-3xl font-extrabold focus:outline-none sm:text-4xl">Waymark Command Center</h1>
            {isDemo && <DemoTag />}
          </div>
          <p className="mt-1 text-sm text-slate-600">Your global supply chain in one view. Estimated figures are labelled.</p>
        </div>
      )}

      {(overSuppliers.over || overShipments.over) && (
        <Notice tone="warn" className="mb-3">
          This plan includes {overSuppliers.limit} suppliers and {overShipments.limit} shipment records. You have {counts.suppliers} and {counts.shipments}. All your data is kept, but adding more is paused. <Link to="/pricing" className="font-semibold underline">Compare plans</Link>
        </Notice>
      )}
      {model.fxIssues.map((issue) => <Notice key={issue} tone="warn" className="mb-2">{issue}</Notice>)}
      {!fx.live && <Notice tone="info" className="mb-3">Live exchange rates are unavailable. Using a dated Bank of Canada snapshot from {fx.asOf}.</Notice>}

      {nothingShown && (
        <Notice tone="info">
          Every Command Center section is turned off. <Link to="/app/settings?tab=display" className="font-semibold underline">Choose what to show</Link>
        </Notice>
      )}

      {show.shipmentStats && (
        <>
          <SectionTitle>Network overview</SectionTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Total suppliers" value={m.suppliers} icon="users" />
            <Kpi label="Active shipments" value={m.activeShipments} icon="box" />
            <Kpi label="Import shipments" value={m.importShipments} icon="download" />
            <Kpi label="Export shipments" value={m.exportShipments} icon="upload" />
            <Kpi label="Delayed shipments" value={m.delayedShipments} icon="clock" tone={m.delayedShipments ? 'bad' : 'good'} />
            <Kpi label="Current risk alerts" value={model.alerts.length} icon="alert" tone={model.alerts.some((a) => a.level === 'review') ? 'bad' : 'warn'} />
          </div>
        </>
      )}

      {show.financeStats && (
        <>
          <SectionTitle>Spend and footprint</SectionTitle>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Annual import spending" value={moneyCompact(m.importSpend)} icon="card" tag={<ProvenanceTag kind={prov.importSpend} />} />
            <Kpi label="Freight spending" value={moneyCompact(m.freightSpend)} icon="truck" tag={<ProvenanceTag kind={prov.freightSpend} />} />
            <Kpi
              label="Estimated transport emissions"
              value={formatCo2e(m.co2eKg)}
              icon="leaf"
              sub={`${model.emissions.shipmentCount} recorded shipments`}
              tag={<><MethodTag method={model.emissions.method} /><Sparkline rows={model.emissions.byMonth} /></>}
            />
            <Kpi
              label="Top sourcing share"
              value={`${Math.round(model.stats.topCountryShare * 100)}%`}
              icon="globe"
              sub={model.stats.topCountry ? `From ${model.suppliers.find((s) => s.country === model.stats.topCountry)?.countryInfo?.name}` : 'No suppliers yet'}
            />
          </div>
        </>
      )}

      {(show.alerts || showActivity) && (
        <>
          <SectionTitle>Risk and activity</SectionTitle>
          <div className={`grid gap-3 ${show.alerts && showActivity ? 'lg:grid-cols-2' : ''}`}>
            {show.alerts && (
              <FeedCard id="alerts" title="Current risk feed" subtitle="Rule-based prompts for review. Not a validated risk score." count={model.alerts.length}>
                <RiskFeed onOpenShipment={setSelected} />
              </FeedCard>
            )}
            {showActivity && (
              <FeedCard title="Activity feed" subtitle="Recorded shipment events and hub weather checks.">
                <ActivityFeed limit={20} onOpenShipment={setSelected} />
              </FeedCard>
            )}
          </div>
        </>
      )}

      {show.featureTiles && (
        <>
          <SectionTitle>What would you like to do?</SectionTitle>
          <nav aria-label="Application" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((f) => <FeatureTile key={f.id} {...f} />)}
          </nav>
        </>
      )}

      <Modal open={Boolean(shipment)} onClose={() => setSelected(null)} title="Shipment details">
        {shipment && <ShipmentDetail shipment={shipment} />}
      </Modal>
    </div>
  )
}
