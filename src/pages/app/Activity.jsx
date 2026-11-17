import { useState } from 'react'
import { Link } from 'react-router-dom'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Card, Notice, PageHeader } from '../../components/app/kit.jsx'
import { Button } from '../../components/ui.jsx'
import { Feedback, Investigate, RunTimeline, usePlatform } from '../../components/app/PlatformKit.jsx'

export default function Activity() {
  const { agentPayload } = useWorkspace()
  const state = usePlatform(platform.monitor)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function act(fn) { setBusy(true); try { await fn(); await state.reload(); setMessage('Monitoring updated.') } catch(e) { setMessage(e.message) } finally { setBusy(false) } }
  const data = state.data
  return <div className="space-y-4"><PageHeader title="Agent Activity" actions={<Button disabled={busy} onClick={() => act(() => platform.runMonitor(agentPayload()))}>Run now</Button>}>Risk monitoring, alerts and recorded tool activity.</PageHeader><Feedback state={state} />{message && <Notice>{message}</Notice>}{data && <>
    <Card tour="monitor-settings" title="Monitoring configuration"><p className="mb-3 text-sm">Last successful run: {data.state.lastSuccessAt ?? 'Never'}. Last error: {data.state.lastError ?? 'None reported'}.</p><Notice>Scheduling: {data.state.scheduled ? `Server checks every ${data.state.intervalMinutes} minutes. See deployment documentation for persistence and single-instance requirements.` : 'Browser fallback checks at most every 30 minutes while the application is open. Continuous monitoring is not enabled.'}</Notice>
      <form className="mt-3 space-y-3 text-sm" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => platform.saveSettings({ monitor: { ...Object.fromEntries(['enabled','delays','weather','news','inventory'].map(k => [k, f.get(k) === 'on'])), minLevel: f.get('minLevel'), costThresholdCad: Number(f.get('cost')) } })) }}>
        {['enabled','delays','weather','news','inventory'].map(k => <label key={k} className="mr-4 inline-flex gap-2"><input name={k} type="checkbox" defaultChecked={data.settings[k]} />{k}</label>)}
        <label className="block">Minimum risk <select name="minLevel" defaultValue={data.settings.minLevel} className="rounded border p-2"><option>medium</option><option>high</option></select></label><label className="block">Cost threshold CAD <input name="cost" type="number" min="0" max="100000000" defaultValue={data.settings.costThresholdCad} className="rounded border p-2" /></label><Button disabled={busy} type="submit">Save monitoring settings</Button>
      </form></Card>
    <Card tour="monitor-alerts" title="Detected alerts"><ul className="space-y-3">{data.alerts.map(a => <li key={a.id} className="rounded border border-slate-200 p-3 text-sm"><strong>{a.title} · {a.level} · {a.status}</strong><p>{a.detail}</p><p>Source: {a.source} · {a.detectedAt}</p>{a.recommendation && <p>Recommended: {a.recommendation.title}</p>}<Investigate task={`Investigate ${a.title}`} /> <button disabled={busy} className="ml-3 underline" onClick={() => act(() => platform.setAlert(a.id, a.status === 'open' ? 'dismissed' : 'open'))}>{a.status === 'open' ? 'Dismiss alert' : 'Reopen alert'}</button></li>)}</ul>{!data.alerts.length && <p>No alerts recorded.</p>}</Card>
    <Card title="Recent monitoring investigations">{data.investigations.map(r => <p key={r.id} className="mb-2 text-sm">{r.task} · {r.status}<br />{r.summary}</p>)}<Link to="/app/agent" className="underline">Reopen investigations</Link> · <Link className="underline" to="/app/approvals">Review approvals</Link></Card><Card title="Tool execution history"><RunTimeline calls={data.toolHistory} /></Card>
  </>}</div>
}
