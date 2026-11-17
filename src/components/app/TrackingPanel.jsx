import { useState } from 'react'
import { platform } from '../../services/api.js'
import { Card, Notice } from './kit.jsx'
import { Button } from '../ui.jsx'
import { Evidence } from './PlatformKit.jsx'

export default function TrackingPanel({ shipment }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Card title="Provider tracking" className="my-3"><Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setData(await platform.track(shipment)) } catch(e) { setError(e.message) } finally { setBusy(false) } }}>{busy ? 'Checking…' : 'Check tracking provider'}</Button>{error && <Notice tone="error">{error}</Notice>}{data && (data.tracking ? <><p className="mt-3 text-sm">{data.tracking.provider} · {data.tracking.demo ? 'Sample fixture, not live tracking' : 'Provider-reported tracking'} · {data.tracking.status}</p><p className="text-sm">ETA: {data.tracking.eta ?? 'Unknown'} · synchronized: {data.tracking.syncedAt ?? 'Unknown'}</p><Evidence label="Last location, health and tracking events" value={data.tracking} /></> : <Notice>{data.reason}</Notice>)}</Card>
}
