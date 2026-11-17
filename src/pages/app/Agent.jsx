// AI Agent Hub: run investigations. Model choice, credentials and data sharing live in Settings → AI & Models.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { BoundedList, Card, CompactPageHeader, Notice, SearchInput, SectionTabs, StatusPill, WorkspaceLayout } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { AiStatusBadge, RunTabs, useAiStatus } from '../../components/app/AiLauncher.jsx'
import ReportAction from '../../components/app/ReportAction.jsx'
import { Feedback, Evidence, usePlatform } from '../../components/app/PlatformKit.jsx'
import { formatDateTime } from '../../i18n/index.js'

export const TASKS = ['Analyze my most at-risk shipment.', 'Find alternative suppliers that reduce cost without increasing delivery risk.', 'Check whether weather conditions could disrupt this shipment.', 'Evaluate the financial impact of a two-week supplier delay.', 'Which customer orders could be affected by the latest disruption?', 'Compare our current supplier with three alternatives.', 'Prepare a supply-chain risk summary for my team.']
const TASK_META = [['alert', 'Risk'], ['users', 'Suppliers'], ['cloud', 'Weather'], ['card', 'Finance'], ['box', 'Customers'], ['scale', 'Suppliers'], ['file', 'Summary']]
const STATUS_TONE = { completed: 'emerald', failed: 'rose', running: 'sky' }

function Timeline({ calls }) {
  return (
    <ol className="space-y-1.5">
      {calls.map((c) => (
        <li key={c.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
          <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c.status === 'running' ? 'animate-pulse bg-sky-500' : c.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className="min-w-0 flex-1"><span className="font-semibold text-navy">{c.name}</span> <span className="text-slate-500">· {c.status}{c.durationMs != null ? ` · ${c.durationMs} ms` : ''}</span>{c.summary && <span className="block text-slate-600">{c.summary}</span>}</span>
        </li>
      ))}
    </ol>
  )
}

/** A run as a report in the shared shape. Uses only the run's own result and tool records. */
function runReport(run) {
  const r = run.result ?? {}
  return {
    title: `AI investigation: ${run.task}`.slice(0, 140),
    typeId: 'agent',
    context: { heading: 'Investigation', lines: [`Task: ${run.task}`, `Provider: ${run.providerLabel ?? 'Built-in planner'}`, `Status: ${run.status}`, `Started: ${run.startedAt ?? ''}`] },
    sections: [
      { heading: 'Executive summary', paragraphs: [r.summary ?? 'No summary was produced.', ...(r.grounded === false ? [`Model output is unverified. Verified tool summary: ${r.verifiedSummary ?? 'see evidence'}`] : [])] },
      ...(r.recommendations?.length ? [{ heading: 'Recommendations', table: { head: ['Priority', 'Recommendation', 'Detail'], rows: r.recommendations.map((x) => [x.priority, x.title, x.detail]) } }] : []),
      ...(r.confidence ? [{ heading: 'Risk assessment and confidence', paragraphs: [`Confidence: ${r.confidence.level}. ${(r.confidence.reasons ?? []).join(' ')}`] }] : []),
      { heading: 'Supporting evidence (tool timeline)', table: { head: ['Tool', 'Status', 'Summary'], rows: (run.toolCalls ?? []).map((c) => [c.name, c.status, c.summary ?? '']) } },
      ...(r.uncertainties?.length ? [{ heading: 'Assumptions and limitations', bullets: r.uncertainties }] : []),
    ],
    sources: (r.dataSources ?? []).slice(0, 20).map((s) => ({ label: s.name ?? s.label ?? 'Source', detail: s.detail ?? s.provenance ?? s.retrievedAt ?? '' })),
  }
}

export default function Agent() {
  const { agentPayload, isDemo, saveRecord } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const ai = useAiStatus()
  const runs = usePlatform(() => platform.runs())
  const [task, setTask] = useState(params.get('task') ?? TASKS[0])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [run, setRun] = useState(null)
  const [calls, setCalls] = useState([])
  const [progress, setProgress] = useState('')

  // A saved run opened from elsewhere (for example the AI launcher) arrives as ?run=<id>.
  const runId = params.get('run')
  useEffect(() => {
    if (!runId) return
    platform.run(runId).then((d) => setRun(d.run)).catch((e) => setMessage({ tone: 'error', text: e.message }))
    setParams({}, { replace: true })
  }, [runId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function investigate(demo = false) {
    setBusy(true); setMessage(null); setRun(null); setCalls([]); setProgress('')
    try {
      if (demo) {
        setProgress('Loading labelled sample business datasets…')
        for (const id of ['quickbooks', 'shopify', 'salesforce', 'project44']) await platform.demo(id, agentPayload())
      }
      const result = await platform.runAgent({ ...agentPayload(), task: demo ? 'Check weather disruption, compare alternatives, evaluate financial and customer impact, generate a report and draft a Slack notification for my team.' : task, provider: demo ? 'planner' : ai.preferred?.id ?? 'planner', ...(demo ? { demoScenario: 'weather' } : {}) }, (event, data) => {
        if (event === 'run') setProgress(`Started ${data.providerLabel}`)
        if (event === 'status') setProgress(data.message)
        if (event === 'text') setProgress('The model is reading tool results and composing findings…')
        if (event === 'tool_start') setCalls((c) => [...c, { ...data, status: 'running' }])
        if (event === 'tool_end') setCalls((c) => [...c.filter((x) => x.id !== data.id), data])
      })
      setRun(result); runs.reload(); setProgress('Investigation finished.')
    } catch (e) {
      setMessage({ tone: 'error', text: `${e.message} Reopen the history to check whether the server completed the run.` })
    } finally { setBusy(false) }
  }
  async function saveReport(report) {
    try { await saveRecord('reports', { ...report, id: crypto.randomUUID(), typeId: report.typeId ?? 'agent', savedAt: new Date().toISOString() }); setMessage({ tone: 'good', text: 'Report saved to Reports.' }) }
    catch (e) { setMessage({ tone: 'error', text: e.message }) }
  }
  const open = async (id) => { try { setRun((await platform.run(id)).run) } catch (e) { setMessage({ tone: 'error', text: e.message }) } }

  const history = (runs.data?.runs ?? []).filter((r) => !filter || r.task.toLowerCase().includes(filter.toLowerCase()))
  const recentTools = (runs.data?.runs ?? []).slice(0, 10).flatMap((r) => (r.tools ?? []).map((t) => ({ run: r, tool: t })))

  return (
    <div className="space-y-3">
      <CompactPageHeader title="AI Agent Hub" description="Investigate your supply chain with Waymark tools. Evidence is shown, and anything sent outside needs human approval." actions={<AiStatusBadge />} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <WorkspaceLayout asideWidth="22rem"
        main={<>
          <Card tour="agent-question" title="Start an investigation">
            <form onSubmit={(e) => { e.preventDefault(); investigate() }} className="space-y-3">
              <label htmlFor="agent-task" className="sr-only">Your question</label>
              <textarea id="agent-task" required maxLength={800} rows={3} placeholder="What should Waymark investigate?" className="block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900" value={task} onChange={(e) => setTask(e.target.value)} />
              <div>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Suggested investigations</p>
                <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {TASKS.map((t, i) => (
                    <li key={t}><button type="button" onClick={() => setTask(t)} aria-pressed={task === t} className={`flex h-full w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-start text-xs ${task === t ? 'border-brand-500 bg-brand-50 text-navy' : 'border-slate-200 text-slate-700 hover:border-brand-200'}`}>
                      <Icon name={TASK_META[i][0]} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-800" /><span>{t}</span>
                    </button></li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={busy || task.trim().length < 3}><Icon name="sparkles" className="h-4 w-4" /> {busy ? 'Investigating…' : 'Run investigation'}</Button>
                {!ai.preferred && <span className="text-xs text-slate-500">Using the built-in planner. <Link to="/app/settings?tab=ai" className="font-semibold text-brand-800 underline">Choose an AI model in Settings</Link></span>}
              </div>
            </form>
          </Card>

          {(busy || progress) && (
            <Card title="Live status" aside={busy ? <StatusPill tone="sky">Running</StatusPill> : <StatusPill tone="emerald">Finished</StatusPill>}>
              <p role="status" className="mb-2 text-sm text-slate-600">{progress}</p>
              {busy && <BoundedList maxHeight="16rem" label="Tool timeline"><Timeline calls={calls} /></BoundedList>}
            </Card>
          )}

          {run && (
            <Card title={`Investigation: ${run.status}`} subtitle={`${run.providerLabel ?? ''} · ${run.startedAt ? formatDateTime(run.startedAt) : ''}`} aside={<ReportAction build={() => runReport(run)} />}>
              <p className="mb-2 text-sm font-medium text-navy">{run.task}</p>
              <RunTabs run={run} idPrefix="hub-run" />
              {(run.reports ?? []).length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Reports prepared by this run</p>
                  {run.reports.map((report, i) => <div key={i} className="flex flex-wrap items-center gap-2"><Evidence value={report} label={report.title} /><Button size="sm" variant="secondary" onClick={() => saveReport(report)}>Save to Reports</Button></div>)}
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">Tokens: {run.usage?.inputTokens ?? 'n/a'} input / {run.usage?.outputTokens ?? 'n/a'} output</p>
            </Card>
          )}

          {isDemo && (
            <Card title="Guided weather demo" subtitle="Sample accounting, commerce, CRM and tracking data with a simulated weather event">
              <Button variant="secondary" disabled={busy} onClick={() => investigate(true)}>Run guided demo</Button>
              <p className="mt-2 text-xs text-slate-500">Uses the internal planner and prepares an unsent notification for approval. Review it in Approvals and Agent Activity.</p>
            </Card>
          )}
        </>}
        aside={
          <Card tour="agent-history" padded>
            <SectionTabs idPrefix="hub-side" label="Investigation history" tabs={[
              { id: 'history', label: 'History', count: runs.data?.runs?.length, content: (
                <div className="space-y-2">
                  <SearchInput label="Filter investigations" value={filter} onChange={setFilter} />
                  <Feedback state={runs} />
                  <BoundedList maxHeight="28rem" label="Investigation history">
                    <ul className="divide-y divide-slate-100">
                      {history.map((r) => (
                        <li key={r.id}><button type="button" disabled={busy} onClick={() => open(r.id)} className="w-full px-1 py-2 text-start hover:bg-slate-50">
                          <span className="line-clamp-2 block text-sm text-navy">{r.task}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><StatusPill tone={STATUS_TONE[r.status] ?? 'slate'}>{r.status}</StatusPill>{r.trigger === 'monitor' && <Badge tone="sky">monitor</Badge>}{r.finishedAt ? formatDateTime(r.finishedAt) : ''}</span>
                        </button></li>
                      ))}
                    </ul>
                    {runs.data && !history.length && <p className="py-2 text-sm text-slate-500">No saved investigations yet.</p>}
                  </BoundedList>
                </div>
              ) },
              { id: 'tools', label: 'Tool activity', content: (
                <BoundedList maxHeight="30rem" label="Recent tool activity">
                  <ul className="space-y-1 text-xs">{recentTools.map(({ run: r, tool }, i) => <li key={`${r.id}-${tool}-${i}`} className="flex justify-between gap-2 rounded border border-slate-100 px-2 py-1"><span className="font-semibold text-navy">{tool}</span><span className="truncate text-slate-500">{r.task}</span></li>)}</ul>
                  {!recentTools.length && <p className="text-sm text-slate-500">No tool activity yet.</p>}
                </BoundedList>
              ) },
            ]} />
          </Card>
        }
      />
    </div>
  )
}
