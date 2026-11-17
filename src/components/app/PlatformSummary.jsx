import { Link } from 'react-router-dom'
import { platform } from '../../services/api.js'
import { Card } from './kit.jsx'
import { Feedback, Investigate, usePlatform } from './PlatformKit.jsx'
export default function PlatformSummary() {
  const state = usePlatform(platform.summary)
  const d = state.data
  return <Card title="Intelligence" className="my-3"><Feedback state={state} />{d && <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><h3 className="font-bold">AI Intelligence</h3><p>{d.ai.provider?.label ?? d.ai.fallback} · Agent {d.agent.health}</p><details><summary>Recent investigations ({d.agent.recent.length})</summary>{d.agent.recent.map(r => <p key={r.id}>{r.task} · {r.status}</p>)}</details><Link className="underline" to="/app/agent">Open Agent Hub</Link></div><div><h3 className="font-bold">Connected Business Data</h3><p>{d.integrations.connected} verified connections · {d.integrations.demo} demo providers</p><p>Latest sync: {d.integrations.lastSyncAt ?? 'None'}</p><Link className="underline" to="/app/integrations">Manage integrations</Link></div><div><h3 className="font-bold">Risk Intelligence</h3><p>{d.alerts.length} recent open alerts</p><details><summary>Detected exposure</summary>{d.alerts.map(a => <p key={a.id}>{a.title} · {a.shipmentRefs?.join(', ')} · {a.source}</p>)}</details><Link className="underline" to="/app/world">Global Risk Intelligence</Link></div><div><h3 className="font-bold">Recommended Actions</h3><p>{d.pendingApprovals} pending approvals</p>{d.alerts.filter(a => a.recommendation).slice(0,2).map(a => <p key={a.id}>{a.recommendation.title}</p>)}<Link className="underline" to="/app/approvals">Review approvals</Link><br /><Investigate task="Analyze my most at-risk shipment" /></div></div>}</Card>
}
