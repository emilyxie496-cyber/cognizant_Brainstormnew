import { modeLabel, statusLabel } from '../../engine/model.js'
import { useState } from 'react'

/** A keyboard and text alternative to the geographic drawing, including static routes. */
export default function MapText({ data, onSelect }) {
  const [open, setOpen] = useState(false)
  const routes = [...new Map(data.segments.map((s) => [s.shipmentId ?? s.routeId, s])).values()]
  return <details className="my-2 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Map locations and routes as text</summary>
    {open && <>
    <ul className="mt-2 space-y-1">{data.nodes.map((node) => <li key={node.id}>
      {onSelect ? <button type="button" className="text-left underline" onClick={() => onSelect({ type: 'node', node })}>{node.label}</button> : node.label}
      {node.detail ? `: ${node.detail}` : ''} ({node.lat.toFixed(2)}, {node.lon.toFixed(2)}){node.affected ? ' — Affected by scenario' : ''}
    </li>)}</ul>
    <ul className="mt-2 space-y-1">{routes.map((route) => {
      const legs = data.segments.filter((s) => s.routeId === route.routeId)
      const description = `${data.vehicles.find((v) => v.shipmentId === route.shipmentId)?.reference ?? route.routeId}: ${legs.map((s) => modeLabel(s.mode)).join(', ')}. ${statusLabel(route.status)}${route.affected ? '. Affected by scenario' : ''}`
      return <li key={route.routeId}>{onSelect && route.shipmentId ? <button type="button" className="text-left underline" onClick={() => onSelect({ type: 'shipment', id: route.shipmentId })}>{description}</button> : description}</li>
    })}</ul>
    {!routes.length && <p>No routes match the current filters.</p>}
    </>}
  </details>
}
