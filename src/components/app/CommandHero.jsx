/*
  Command Center hero: the 3D scene with the page title, data status, a vehicle
  switcher and a status card for a real shipment travelling by that mode.
*/
import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { modeLabel, statusLabel } from '../../engine/model.js'
import { VEHICLES, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Icon } from '../ui.jsx'
import { DemoTag, formatDate } from './kit.jsx'

const HeroScene = lazy(() => import('./scene/HeroScene.jsx'))

/** The shipment to feature: travelling by this mode, delayed first, then soonest to arrive. */
function featuredShipment(shipments, mode) {
  const usesMode = (s) => s.mode === mode || s.inlandMode === mode || s.legs?.some((leg) => leg.mode === mode)
  return shipments
    .filter((s) => s.active && usesMode(s))
    .sort((a, b) => (b.status === 'delayed') - (a.status === 'delayed') || String(a.eta).localeCompare(String(b.eta)))[0]
}

function Glass({ className = '', children }) {
  return <div className={`wm-glass pointer-events-auto rounded-2xl ${className}`}>{children}</div>
}

export default function CommandHero({ onOpenShipment }) {
  const { model, isDemo, health, fx } = useWorkspace()
  const { prefs, setVehicle } = useViewPrefs()
  const vehicle = VEHICLES.find((v) => v.id === prefs.vehicle) ?? VEHICLES[0]
  const shipment = featuredShipment(model.shipments, vehicle.mode)
  const apiOnline = health && health.ok !== false
  const mode = modeLabel(vehicle.mode).toLowerCase()

  return (
    <section className="wm-hero relative mb-5 overflow-hidden rounded-3xl border border-slate-200" aria-label="Command Center">
      <Suspense fallback={null}>
        <HeroScene vehicle={vehicle.id} />
      </Suspense>
      <div className="wm-hero-shade pointer-events-none absolute inset-0" />

      <div className="pointer-events-none relative flex min-h-[38rem] flex-col sm:min-h-[27rem] gap-4 p-5 sm:p-7 lg:min-h-[25rem]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h1 tabIndex={-1} className="focus:outline-none">
              <span className="block text-xs font-bold tracking-[0.3em] text-brand-300 uppercase">Waymark</span>{' '}
              <span className="wm-hero-title font-display block text-4xl leading-tight font-extrabold tracking-tight uppercase sm:text-5xl">Command Center</span>
            </h1>
            <p className="mt-2 max-w-md text-sm text-slate-700 sm:text-base">Your global supply chain in one view. Estimated figures are labelled.</p>
            {isDemo && <div className="pointer-events-auto mt-3 inline-block"><DemoTag /></div>}
          </div>

          <Glass className="hidden px-4 py-3 text-xs sm:block">
            <p className="font-bold tracking-wider text-slate-900 uppercase">Data status</p>
            <p className="mt-1.5 flex items-center gap-2 text-slate-800">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${health === null ? 'bg-slate-400' : apiOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {health === null ? 'Checking the API…' : apiOnline ? 'API online' : 'API offline: local fallbacks'}
            </p>
            <p className="mt-1.5 border-t border-white/10 pt-1.5 text-slate-600">
              Exchange rates: {fx.live ? 'live' : 'snapshot'}{fx.asOf ? `, ${fx.asOf}` : ''}
            </p>
          </Glass>
        </div>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-4">
          <div className="pointer-events-auto">
            <p id="scene-vehicle" className="mb-1.5 text-[0.6875rem] font-semibold tracking-wider text-slate-600 uppercase">Scene</p>
            <div data-tour="vehicle-switcher" role="group" aria-labelledby="scene-vehicle" className="wm-glass inline-flex flex-wrap gap-1 rounded-xl p-1">
              {VEHICLES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={vehicle.id === v.id}
                  aria-label={v.label}
                  title={v.label}
                  onClick={() => setVehicle(v.id)}
                  className={`flex h-9 w-10 items-center justify-center rounded-lg transition-colors ${vehicle.id === v.id ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-white/10 hover:text-white'}`}
                >
                  <Icon name={v.icon} className="h-[18px] w-[18px]" />
                </button>
              ))}
            </div>
            <p className="mt-1.5 hidden text-[0.6875rem] text-slate-500 sm:block">Drag the scene to look around.</p>
          </div>

          <Glass className="w-full max-w-[17rem] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-bold tracking-wider text-slate-600 uppercase">{modeLabel(vehicle.mode)} shipment status</p>
                <p className="font-display mt-0.5 truncate text-xl font-extrabold text-white uppercase">{shipment ? statusLabel(shipment.status) : 'None active'}</p>
              </div>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${shipment?.status === 'delayed' ? 'bg-rose-50 text-rose-700' : 'bg-brand-100 text-brand-300'}`}>
                <Icon name={vehicle.icon} />
              </span>
            </div>
            {shipment ? (
              <>
                <dl className="mt-2 space-y-0.5 text-sm text-slate-700">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Reference</dt><dd className="font-semibold text-white">{shipment.reference}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Carrier</dt><dd className="truncate">{shipment.carrier || 'Unknown'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">ETA</dt><dd>{formatDate(shipment.eta)}</dd></div>
                </dl>
                <button type="button" onClick={() => onOpenShipment(shipment.id)} className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-brand-800 hover:underline">
                  View details <Icon name="arrowRight" className="h-4 w-4" />
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">
                No active shipment uses {mode} freight.{' '}
                {prefs.features.shipments && <Link to="/app/shipments" className="font-semibold text-brand-800 hover:underline">Open shipments</Link>}
              </p>
            )}
          </Glass>
        </div>
      </div>
    </section>
  )
}
