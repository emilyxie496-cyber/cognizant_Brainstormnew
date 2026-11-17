/*
  Contextual AI: one launcher used by every page that can hand work to the agent.

  It runs the same server investigation as the AI Agent Hub (POST /api/agent/run,
  streamed), so authorization, data-sharing settings, tool limits and human
  approval all apply unchanged. The provider is the one saved in Settings → AI &
  Models; with none saved, the built-in planner runs inside Waymark and nothing is
  sent to an external model. The page supplies only a starting task and a short
  description of its context; it never supplies results.
*/
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from '../../i18n/index.js'
import { platform } from '../../services/api.js'
import { useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Badge, Button, Icon } from '../ui.jsx'
import { BoundedList, Drawer, Notice, SectionTabs, StatusPill } from './kit.jsx'

// Provider status is shared by every launcher on the page and refreshed when a drawer opens.
let aiState = { status: 'idle', data: null, error: null }
const aiListeners = new Set()
const setAi = (next) => { aiState = { ...aiState, ...next }; aiListeners.forEach((fn) => fn()) }
export async function refreshAiStatus() {
  setAi({ status: 'loading' })
  try {
    const data = await platform.aiProviders()
    setAi({ status: 'ready', data, error: null })
  } catch (err) {
    setAi({ status: 'error', error: err.message })
  }
}

/** The preferred provider if it is connected; otherwise null (the built-in planner). */
export function useAiStatus() {
  const state = useSyncExternalStore((fn) => { aiListeners.add(fn); return () => aiListeners.delete(fn) }, () => aiState, () => aiState)
  useEffect(() => { if (aiState.status === 'idle') refreshAiStatus() }, [])
  const providers = state.data?.providers ?? []
  const preferred = providers.find((p) => p.id === state.data?.preferred && p.ready) ?? null
  return { ...state, preferred, providers, reload: refreshAiStatus }
}

/** "Active AI: Claude · Configured", or the built-in planner with a link to Settings. */
export function AiStatusBadge({ compact = false }) {
  const { t } = useTranslation()
  const ai = useAiStatus()
  if (ai.status === 'loading' && !ai.data) return <StatusPill tone="slate">{t('ai.checking')}</StatusPill>
  if (ai.status === 'error') return <StatusPill tone="amber">{t('ai.providerStatus')}: {t('status.unavailable')}</StatusPill>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {ai.preferred
        ? <StatusPill tone="emerald">{t('ai.active', { name: ai.preferred.label })} · {t('ai.configured')}{ai.preferred.model && !compact ? ` · ${ai.preferred.model}` : ''}</StatusPill>
        : <StatusPill tone="sky">{t('ai.active', { name: t('ai.planner') })}</StatusPill>}
      {!compact && <Link to="/app/settings?tab=ai" className="text-xs font-semibold text-brand-800 hover:underline">{t('ai.configure')}</Link>}
    </span>
  )
}

function Timeline({ calls }) {
  if (!calls.length) return null
  return (
    <ol className="space-y-1.5">
      {calls.map((c) => (
        <li key={c.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs">
          <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c.status === 'running' ? 'animate-pulse bg-sky-500' : c.status === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-navy">{c.name}</span> <span className="text-slate-500">· {c.status}{c.durationMs != null ? ` · ${c.durationMs} ms` : ''}</span>
            {c.summary && <span className="block text-slate-600">{c.summary}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** The result of a run, in tabs. Shared with the AI Agent Hub. */
export function RunTabs({ run, calls = run?.toolCalls ?? [], idPrefix = 'run' }) {
  const { t } = useTranslation()
  const r = run?.result
  if (!run) return null
  const recs = r?.recommendations ?? []
  return (
    <div className="space-y-2">
      {run.error && <Notice tone="error">{run.error}</Notice>}
      {r?.grounded === false && <Notice tone="warn">{t('ai.unverified', { text: r.verifiedSummary ?? '' })}</Notice>}
      {(run.notices ?? []).map((x, i) => <Notice key={i} tone="warn">{x}</Notice>)}
      <SectionTabs idPrefix={idPrefix} label={t('ai.title')} tabs={[
        { id: 'summary', label: t('ai.summary'), content: (
          <div className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap text-slate-700">{r?.summary ?? t('ai.noResult')}</p>
            {r?.confidence && <p className="text-xs text-slate-500">Confidence: {r.confidence.level}. {r.confidence.reasons?.join(' ')}</p>}
            {(r?.uncertainties ?? []).map((x, i) => <p key={i} className="text-xs text-amber-700">Uncertainty: {x}</p>)}
          </div>
        ) },
        { id: 'recs', label: t('ai.recommendations'), count: recs.length, content: recs.length ? (
          <ul className="space-y-2">{recs.map((x, i) => <li key={i} className="rounded-lg border border-slate-200 p-2.5 text-sm"><p className="font-semibold text-navy"><Badge tone={x.priority === 'high' ? 'rose' : x.priority === 'medium' ? 'amber' : 'slate'}>{x.priority}</Badge> {x.title}</p><p className="mt-1 text-slate-600">{x.detail}</p></li>)}</ul>
        ) : <p className="text-sm text-slate-500">{t('ai.noResult')}</p> },
        { id: 'evidence', label: t('ai.steps'), count: calls.length, content: <BoundedList maxHeight="18rem" label={t('ai.steps')}><Timeline calls={calls} /></BoundedList> },
      ]} />
      {!!run.approvalIds?.length && <Link className="inline-block text-sm font-semibold text-brand-800 underline" to="/app/approvals">{t('ai.approvals', { count: run.approvalIds.length })}</Link>}
    </div>
  )
}

/**
 * @param task    the starting question, written by the page from its own records
 * @param context short lines describing what the page is showing, e.g. "Shipment SH-1042, Shanghai → Toronto"
 */
export default function AiLauncher({ task, context = [], label, size = 'sm', variant = 'secondary', className = '' }) {
  const { t } = useTranslation()
  const { prefs } = useViewPrefs()
  const { agentPayload } = useWorkspace()
  const ai = useAiStatus()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(task)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [calls, setCalls] = useState([])
  const [run, setRun] = useState(null)
  const [error, setError] = useState('')
  if (!prefs.features.agent) return null

  const launch = () => {
    setText(task)
    setRun(null); setCalls([]); setError(''); setProgress('')
    setOpen(true)
    ai.reload()
  }

  const investigate = async (e) => {
    e.preventDefault()
    const question = [text.trim(), context.length ? `Context: ${context.join('; ')}` : ''].filter(Boolean).join('\n').slice(0, 800)
    if (question.length < 3) return
    setBusy(true); setError(''); setRun(null); setCalls([])
    try {
      const result = await platform.runAgent({ ...agentPayload(), task: question, provider: ai.preferred?.id ?? 'planner' }, (event, data) => {
        if (event === 'run') setProgress(`${data.providerLabel ?? ''}`)
        if (event === 'status') setProgress(data.message)
        if (event === 'tool_start') setCalls((c) => [...c, { ...data, status: 'running' }])
        if (event === 'tool_end') setCalls((c) => [...c.filter((x) => x.id !== data.id), data])
      })
      setRun(result)
      setProgress('')
    } catch (err) {
      setError(`${err.message} ${t('ai.failed')}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={launch} className={className} data-tour="ai-launcher">
        <Icon name="sparkles" className="h-4 w-4" /> {label ?? t('ai.launch')}
      </Button>
      <Drawer open={open} onClose={() => !busy && setOpen(false)} title={t('ai.title')} subtitle={t('ai.sharing')} size="md"
        footer={run && <Link to={`/app/agent?run=${encodeURIComponent(run.id)}`} className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">{t('ai.openHub')}</Link>}>
        <div className="space-y-3">
          <AiStatusBadge />
          {!ai.preferred && ai.status !== 'loading' && <p className="text-xs text-slate-500">{t('ai.plannerNote')}</p>}
          {context.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="mb-0.5 font-semibold text-navy">{t('ai.context')}</p>
              <ul className="space-y-0.5">{context.map((c, i) => <li key={i}><bdi>{c}</bdi></li>)}</ul>
            </div>
          )}
          <form onSubmit={investigate} className="space-y-2">
            <label className="block text-sm font-semibold text-navy" htmlFor="ai-launch-task">{t('ai.task')}</label>
            <textarea id="ai-launch-task" required maxLength={700} rows={3} value={text} onChange={(e) => setText(e.target.value)} className="block w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-900" />
            <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>{busy ? t('ai.running') : t('ai.run')}</Button>
          </form>
          <p role="status" className="text-xs text-slate-500">{progress}</p>
          {error && <Notice tone="error">{error}</Notice>}
          {busy && <BoundedList maxHeight="14rem" label={t('ai.steps')}><Timeline calls={calls} /></BoundedList>}
          {run && <RunTabs run={run} idPrefix="launcher" />}
        </div>
      </Drawer>
    </>
  )
}
