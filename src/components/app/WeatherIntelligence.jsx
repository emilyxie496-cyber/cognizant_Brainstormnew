import { useMemo } from 'react'
import { useWeatherAlerts } from './ActivityFeed.jsx'
import { Card, Notice } from './kit.jsx'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Button } from '../ui.jsx'
import { Investigate } from './PlatformKit.jsx'
const condition = code => ({0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',56:'Freezing drizzle',57:'Dense freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Heavy rain showers',82:'Violent rain showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Severe thunderstorm with hail'})[code] ?? 'Condition unavailable'

export default function WeatherIntelligence({ shipment, onScenario }) {
  const { model } = useWorkspace()
  const scoped = useMemo(() => shipment ? { ...model, shipments: [shipment] } : model, [model, shipment])
  const weather = useWeatherAlerts(scoped)
  return <Card title={shipment ? `Route weather: ${shipment.reference}` : 'Weather intelligence'} className="my-3"><p className="text-xs">Three-day forecasts indicate possible exposure; they do not confirm shipment delays.</p>
    {weather.loading && <p role="status" className="text-sm">Checking forecasts…</p>}
    {weather.error && <Notice tone="warn">{weather.error}</Notice>}
    {!weather.loading && !weather.error && <p className="mt-2 text-sm">{weather.checked ?? 0} active hubs checked · {weather.alerts.length} severe-weather signals · retrieved {weather.checkedAt ?? 'not available'}{weather.checkedAt && Date.now() - Date.parse(weather.checkedAt) > 3600000 ? ' (stale; refresh forecasts)' : ''}</p>}
    {!!weather.unavailable && <p className="text-sm">{weather.unavailable} location checks unavailable; this forecast view is partial.</p>}
    {!!weather.locations?.length && <details className="mt-2 text-sm"><summary>Forecast conditions by location</summary>{weather.locations.map(l => <div key={l.name} className="mt-2"><strong>{l.name}</strong><p>{l.source} · retrieved {l.at}</p>{l.days.map(d => <p key={d.date}>{d.date}: {condition(d.weatherCode)} · max wind {d.windKmh ?? 'unknown'} km/h · precipitation {d.precipitationMm ?? 'unknown'} mm</p>)}</div>)}</details>}
    {weather.alerts.map(a => <div key={a.id} className="mt-2 text-sm"><p>{a.message} · {a.source}</p><p>Potential exposure: {(a.shipmentRefs ?? []).join(', ') || 'Review route dependencies'} · forecast {a.date} · retrieved {a.at}</p><Investigate task={`Check ${a.message} and potential shipment exposure`} />{onScenario && a.hubCode && <Button variant="secondary" onClick={() => onScenario(a)}>Use in severe-weather scenario</Button>}</div>)}
  </Card>
}
