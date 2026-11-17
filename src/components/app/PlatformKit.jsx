import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Notice, Skeleton } from './kit.jsx'
import { Button } from '../ui.jsx'

export function usePlatform(load, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: null })
  const reload = useCallback(async () => {
    set(s => ({ ...s, loading: true, error: null }))
    try { const data = await load(); set({ loading: false, data, error: null }); return data }
    catch (e) { set(s => ({ ...s, loading: false, error: e.message })); return null }
  }, deps) // callers supply the workspace-scoped dependencies
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
export function Feedback({ state }) {
  return <>{state.loading && <Skeleton className="h-24" />}{state.error && <Notice tone="error">{state.error} <button className="underline" onClick={state.reload}>Retry</button></Notice>}</>
}
export function Evidence({ value, label = 'Supporting records' }) {
  return <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">{label}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></details>
}
export function Investigate({ task, children = 'Investigate' }) {
  return <Link className="inline-flex min-h-9 items-center font-semibold text-brand-800 underline" to={`/app/agent?task=${encodeURIComponent(task.slice(0,800))}`}>{children}</Link>
}
export function RunTimeline({ calls = [] }) {
  return <ol className="space-y-2">{calls.map(c => <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-semibold">{c.name} · {c.status} · {c.durationMs ?? 0} ms</p><p>{c.summary}</p>{c.output && <Evidence value={c.output} label="Tool evidence" />}</li>)}</ol>
}
export function RunResult({ run, saveReport }) {
  if (!run) return null
  const r = run.result
  return <Card title={`Investigation: ${run.status}`} subtitle={`${run.providerLabel} · ${run.startedAt ?? ''}`}>
    {run.error && <Notice tone="error">{run.error}</Notice>}
    {r?.grounded === false && <Notice tone="warn">Model output is unverified. Verified tool summary: {r.verifiedSummary ?? 'Review the tool evidence.'}</Notice>}
    <p className="whitespace-pre-wrap text-sm">{r?.summary}</p>
    {r?.confidence && <p className="mt-3 text-sm">Confidence: {r.confidence.level}. {r.confidence.reasons.join(' ')}</p>}
    {(r?.recommendations ?? []).map((x,i) => <div key={i} className="mt-3 text-sm"><strong>{x.priority}: {x.title}</strong><p>{x.detail}</p></div>)}
    {(r?.uncertainties ?? []).map((x,i) => <p key={i} className="mt-2 text-sm">Uncertainty: {x}</p>)}
    {(run.notices ?? []).map((x,i) => <Notice key={i} tone="warn">{x}</Notice>)}
    <Evidence value={r?.dataSources ?? []} label="Data sources and provenance" />
    <p className="my-2 text-xs">Tokens: {run.usage?.inputTokens ?? 'unavailable'} input / {run.usage?.outputTokens ?? 'unavailable'} output</p>
    <RunTimeline calls={run.toolCalls} />
    {(run.reports ?? []).map((report,i) => <div key={i} className="mt-3"><Evidence value={report} label={report.title} />{saveReport && <Button onClick={() => saveReport(report)}>Save report to Reports</Button>}</div>)}
    {!!run.approvalIds?.length && <Link className="mt-3 inline-block underline" to="/app/approvals">Review {run.approvalIds.length} approval request(s)</Link>}
  </Card>
}
