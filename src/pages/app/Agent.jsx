import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Card, Notice, PageHeader } from '../../components/app/kit.jsx'
import { Button } from '../../components/ui.jsx'
import AiPreferences from '../../components/app/AiPreferences.jsx'
import { Feedback, RunResult, RunTimeline, usePlatform } from '../../components/app/PlatformKit.jsx'

export const TASKS = ['Analyze my most at-risk shipment.', 'Find alternative suppliers that reduce cost without increasing delivery risk.', 'Check whether weather conditions could disrupt this shipment.', 'Evaluate the financial impact of a two-week supplier delay.', 'Which customer orders could be affected by the latest disruption?', 'Compare our current supplier with three alternatives.', 'Prepare a supply-chain risk summary for my team.']
export default function Agent() {
  const { agentPayload, isDemo, saveRecord } = useWorkspace()
  const [params] = useSearchParams()
  const state = usePlatform(async () => ({ ...await platform.aiProviders(), ...await platform.runs() }))
  const [task, setTask] = useState(params.get('task') ?? TASKS[0])
  const [provider, setProvider] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [run, setRun] = useState(null)
  const [calls, setCalls] = useState([])
  const [progress, setProgress] = useState('')
  const selected = provider ?? state.data?.preferred ?? ''
  async function investigate(demo = false) {
    setBusy(true); setMessage(''); setRun(null); setCalls([])
    try {
      if (demo) {
        setProgress('Loading labeled sample business datasets…')
        for (const id of ['quickbooks','shopify','salesforce','project44']) await platform.demo(id, agentPayload())
      }
      const result = await platform.runAgent({ ...agentPayload(), task: demo ? 'Check weather disruption, compare alternatives, evaluate financial and customer impact, generate a report and draft a Slack notification for my team.' : task, provider: demo ? 'planner' : selected || 'planner', ...(demo ? { demoScenario: 'weather' } : {}) }, (event, data) => {
        if (event === 'run') setProgress(`Started ${data.providerLabel}`)
        if (event === 'status') setProgress(data.message)
        if (event === 'text') setProgress('Model is reading tool results and composing findings…')
        if (event === 'tool_start') setCalls(c => [...c, { ...data, status: 'running' }])
        if (event === 'tool_end') setCalls(c => [...c.filter(x => x.id !== data.id), data])
        if (event === 'done') setRun(data)
      })
      setRun(result); await state.reload(); setProgress('Investigation finished.')
    } catch (e) { setMessage(e.message + ' Reopen saved history to check whether the server completed the run.') }
    finally { setBusy(false) }
  }
  async function saveReport(report) {
    try { await saveRecord('reports', { ...report, id: crypto.randomUUID(), typeId: report.typeId ?? 'agent', savedAt: new Date().toISOString() }); setMessage('Report saved to Reports.') }
    catch(e) { setMessage(e.message) }
  }
  return <div className="space-y-4"><PageHeader title="AI Agent Hub">Investigate your supply chain using Waymark tools, with evidence and human approval for external actions.</PageHeader><Feedback state={state} />{message && <Notice>{message}</Notice>}
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]"><div className="space-y-4"><Card tour="agent-question" title="Start an investigation"><form onSubmit={e => { e.preventDefault(); investigate() }} className="space-y-3">
      <label className="block text-sm">Investigation provider<select aria-label="Investigation provider" value={selected} onChange={e => setProvider(e.target.value)} className="mt-1 block w-full rounded-lg border p-2"><option value="">Built-in planner</option>{state.data?.providers.map(p => <option key={p.id} value={p.id} disabled={!p.ready}>{p.label} · {p.model || p.statusLabel}</option>)}</select></label>
      <label className="block text-sm">Your question<textarea required maxLength={800} className="mt-1 block min-h-28 w-full rounded-lg border p-3" value={task} onChange={e => setTask(e.target.value)} /></label>
      <Button type="submit" disabled={busy || !task.trim()}>{busy ? 'Investigating…' : 'Run investigation'}</Button> <Link to="/app/settings?tab=integrations" className="text-sm underline">Configure an AI model</Link>
    </form><details className="mt-4"><summary>Suggested investigations</summary><div className="flex flex-col items-start gap-2 pt-2">{TASKS.map(t => <button key={t} className="text-left text-sm underline" onClick={() => setTask(t)}>{t}</button>)}</div></details></Card>
    {isDemo && <Card title="Guided weather demo"><p className="mb-3 text-sm">Load sample accounting, commerce, CRM and tracking data, investigate a simulated weather event with the internal planner, compare responses and prepare an unsent notification for approval. Reopen Approvals and Agent Activity to review the audit trail.</p><Button disabled={busy} onClick={() => investigate(true)}>Run guided demo</Button></Card>}
    <p role="status" className="text-sm">{progress}</p>{busy && <RunTimeline calls={calls} />}<RunResult run={run} saveReport={saveReport} /></div>
    <div className="space-y-4"><AiPreferences onSaved={state.reload} /><Card tour="agent-history" title="Investigation history"><ul className="space-y-3">{state.data?.runs.map(r => <li key={r.id}><button className="text-left text-sm underline" disabled={busy} onClick={async () => { try { setRun((await platform.run(r.id)).run) } catch(e) { setMessage(e.message) } }}>{r.task} · {r.status}</button></li>)}</ul>{!state.data?.runs.length && <p className="text-sm">No saved investigations yet.</p>}</Card></div></div>
  </div>
}
