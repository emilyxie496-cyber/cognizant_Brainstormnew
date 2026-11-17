/*
  Weather summary: one compact row (risk level, locations checked, severe signals,
  retrieval time) with the full forecast in a drawer on demand. Forecasts indicate
  possible exposure; they never confirm a delay.
*/
import { useMemo, useState } from 'react'
import { useWeatherAlerts } from './ActivityFeed.jsx'
import { DataTable, Drawer, Notice, SectionTabs, StatusPill } from './kit.jsx'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { formatDateTime } from '../../i18n/index.js'
import { Button, Icon } from '../ui.jsx'
import { Investigate } from './PlatformKit.jsx'

const condition = (code) => ({ 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Dense freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail' })[code] ?? 'Condition unavailable'

/** The weather data for the whole network, or for one shipment's route. */
export function useWeather(shipment) {
  const { model } = useWorkspace()
  const scoped = useMemo(() => (shipment ? { ...model, shipments: [shipment] } : model), [model, shipment])
  return useWeatherAlerts(scoped)
}

export function weatherRisk(weather) {
  if (weather.loading) return { tone: 'slate', label: 'Checking' }
  if (weather.error) return { tone: 'amber', label: 'Unavailable' }
  const n = weather.alerts.length
  return n >= 3 ? { tone: 'rose', label: 'Elevated' } : n ? { tone: 'amber', label: 'Watch' } : { tone: 'emerald', label: 'Low' }
}

function WeatherDetails({ weather, onScenario }) {
  const rows = (weather.locations ?? []).flatMap((l) => l.days.map((d) => ({ id: `${l.name}-${d.date}`, location: l.name, source: l.source, at: l.at, ...d })))
  return (
    <SectionTabs idPrefix="weather" label="Weather details" tabs={[
      { id: 'signals', label: 'Risk signals', count: weather.alerts.length, content: weather.alerts.length ? (
        <ul className="space-y-2">
          {weather.alerts.map((a) => (
            <li key={a.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-900">{a.message}</p>
              <p className="mt-0.5 text-xs text-slate-600">Potential exposure: {(a.shipmentRefs ?? []).join(', ') || 'review route dependencies'} · forecast {a.date} · {a.source} · retrieved {a.at}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Investigate task={`Check ${a.message} and potential shipment exposure`} />
                {onScenario && a.hubCode && <Button size="sm" variant="secondary" onClick={() => onScenario(a)}>Use in severe-weather scenario</Button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-600">No severe-weather signals in the three-day forecast.</p> },
      { id: 'forecast', label: 'Forecast by location', count: weather.locations?.length ?? 0, content: (
        <DataTable caption="Three-day forecast by location" rowKey={(r) => r.id} rows={rows} empty={<p className="text-sm text-slate-600">No forecast locations.</p>} columns={[
          { key: 'location', label: 'Location', render: (r) => <span className="font-semibold text-navy">{r.location}</span> },
          { key: 'date', label: 'Date', render: (r) => <span className="whitespace-nowrap">{r.date}</span> },
          { key: 'cond', label: 'Conditions', render: (r) => condition(r.weatherCode) },
          { key: 'wind', label: 'Max wind', right: true, render: (r) => r.windKmh != null ? `${r.windKmh} km/h` : '—' },
          { key: 'rain', label: 'Precip.', right: true, render: (r) => r.precipitationMm != null ? `${r.precipitationMm} mm` : '—' },
        ]} />
      ) },
    ]} />
  )
}

/** Compact weather summary. `weather` may be passed in when the caller already loaded it. */
export default function WeatherIntelligence({ shipment, onScenario, weather: given, className = '' }) {
  const own = useWeather(given ? null : shipment)
  const weather = given ?? own
  const [open, setOpen] = useState(false)
  const risk = weatherRisk(weather)
  const stale = weather.checkedAt && Date.now() - Date.parse(weather.checkedAt) > 3_600_000
  return (
    <>
      <section aria-label={shipment ? `Route weather for ${shipment.reference}` : 'Weather summary'} className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm shadow-slate-900/5 ${className}`}>
        <span className="flex items-center gap-2 text-sm font-bold text-navy"><Icon name="cloudRain" className="h-5 w-5 text-sky-800" />{shipment ? `Route weather · ${shipment.reference}` : 'Weather'}</span>
        <StatusPill tone={risk.tone}>Risk: {risk.label}</StatusPill>
        {!weather.loading && !weather.error && (
          <span className="flex flex-wrap gap-x-3 text-xs text-slate-600">
            <span><strong className="text-navy tabular-nums">{weather.checked ?? 0}</strong> locations checked</span>
            <span><strong className="text-navy tabular-nums">{weather.alerts.length}</strong> severe signals</span>
            <span>Retrieved {weather.checkedAt ? formatDateTime(weather.checkedAt) : 'not available'}{stale ? ' (stale)' : ''}</span>
            {!!weather.unavailable && <span className="text-amber-700">{weather.unavailable} unavailable</span>}
          </span>
        )}
        {weather.loading && <span role="status" className="text-xs text-slate-500">Checking forecasts…</span>}
        {weather.error && <span className="text-xs text-amber-700">{weather.error}</span>}
        <Button size="sm" variant="secondary" className="ms-auto" disabled={weather.loading} onClick={() => setOpen(true)}>View details</Button>
      </section>
      <Drawer open={open} onClose={() => setOpen(false)} title={shipment ? `Route weather: ${shipment.reference}` : 'Weather intelligence'} subtitle="Three-day forecasts indicate possible exposure; they do not confirm shipment delays." size="lg">
        {weather.error ? <Notice tone="warn">{weather.error}</Notice> : <WeatherDetails weather={weather} onScenario={onScenario && ((a) => { setOpen(false); onScenario(a) })} />}
      </Drawer>
    </>
  )
}

