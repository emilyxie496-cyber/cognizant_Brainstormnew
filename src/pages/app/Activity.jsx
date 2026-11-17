// Agent Activity: a compact monitoring dashboard. Monitoring runs and duplicate suppression stay on the server.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { BoundedList, Card, CompactPageHeader, DataTable, Drawer, Metric, MetricGrid, Notice, Pager, SectionTabs, Segmented, StatusPill, usePaged } from '../../components/app/kit.jsx'
import { Badge, Button } from '../../components/ui.jsx'
import { Feedback, Investigate, usePlatform } from '../../components/app/PlatformKit.jsx'
import { formatDateTime } from '../../i18n/index.js'

const LEVEL_TONE = { high: 'rose', medium: 'amber', low: 'slate' }
const SWITCHES = [['enabled', 'Monitoring on'], ['delays', 'Delays'], ['weather', 'Weather'], ['news', 'News'], ['inventory', 'Inventory']]
const when = (v) => (v ? formatDateTime(v) : 'Never')

export default function Activity() {
  const { agentPayload } = useWorkspace()
  const state = usePlatform(platform.monitor)
  const approvals = usePlatform(platform.approvals)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [alertFilter, setAlertFilter] = useState('open')
  const [detail, setDetail] = useState(null)
  async function act(fn, ok = 'Monitoring updated.') {
    setBusy(true)
    try { await fn(); await state.reload(); setMessage({ tone: 'good', text: ok }) } catch (e) { setMessage({ tone: 'error', text: e.message }) } finally { setBusy(false) }
  }
  const data = state.data
  const alerts = (data?.alerts ?? []).filter((a) => alertFilter === 'all' || a.status === alertFilter)
  const pagedAlerts = usePaged(alerts, 10, alertFilter)
  const pagedTools = usePaged(data?.toolHistory ?? [], 12)
  const pending = (approvals.data?.approvals ?? []).filter((a) => a.status === 'pending').length
  const latest = data?.alerts?.find((a) => a.status === 'open')

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Agent Activity" description="Risk monitoring, alerts and recorded tool activity."
        actions={<Button disabled={busy} onClick={() => act(() => platform.runMonitor(agentPayload()), 'Monitoring run finished.')}>{busy ? 'Running…' : 'Run now'}</Button>} />
      <Feedback state={state} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data && <>
        <MetricGrid max={5}>
          <Metric label="Monitoring" value={data.settings.enabled ? 'On' : 'Off'} tone={data.settings.enabled ? 'good' : 'warn'} sub={data.state.scheduled ? `Every ${data.state.intervalMinutes} min` : 'Browser fallback'} />
          <Metric label="Last successful run" value={data.state.lastSuccessAt ? formatDateTime(data.state.lastSuccessAt, { dateStyle: 'short', timeStyle: 'short' }) : 'Never'} sub={data.state.lastError ? 'Last run reported an error' : undefined} tone={data.state.lastError ? 'warn' : 'default'} />
          <Metric label="Latest risk alert" value={latest ? latest.level : 'None'} sub={latest?.title} tone={latest?.level === 'high' ? 'bad' : latest ? 'warn' : 'good'} />
          <Metric label="Pending approvals" value={approvals.data ? pending : '…'} tone={pending ? 'warn' : 'default'} />
          <Metric label="Recent investigations" value={data.investigations.length} />
        </MetricGrid>

        <Card padded>
          <SectionTabs idPrefix="activity" label="Agent activity" tabs={[
            { id: 'monitoring', label: 'Monitoring', content: (
              <div data-tour="monitor-settings" className="space-y-3">
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => platform.saveSettings({ monitor: { ...Object.fromEntries(SWITCHES.map(([k]) => [k, f.get(k) === 'on'])), minLevel: f.get('minLevel'), costThresholdCad: Number(f.get('cost')) } }), 'Monitoring settings saved.') }}>
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="mb-1 text-sm font-semibold text-navy">What to monitor</legend>
                    {SWITCHES.map(([k, label]) => <label key={k} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-sm"><input name={k} type="checkbox" defaultChecked={data.settings[k]} />{label}</label>)}
                  </fieldset>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm font-semibold text-navy">Minimum risk level<select name="minLevel" defaultValue={data.settings.minLevel} className="mt-1 block w-40 text-sm font-normal"><option value="medium">Medium</option><option value="high">High</option></select></label>
                    <label className="text-sm font-semibold text-navy">Cost threshold (CAD)<input name="cost" type="number" min="0" max="100000000" defaultValue={data.settings.costThresholdCad} className="mt-1 block h-10 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900" /></label>
                    <Button disabled={busy} type="submit">Save settings</Button>
                  </div>
                </form>
                <p className="text-xs text-slate-500">Scheduling: {data.state.scheduled ? `the server checks every ${data.state.intervalMinutes} minutes.` : 'the browser checks at most every 30 minutes while Waymark is open. Continuous monitoring is not enabled.'} Last error: {data.state.lastError ?? 'none reported'}. Repeated alerts are recognised and not raised twice.</p>
              </div>
            ) },
            { id: 'alerts', label: 'Alerts', count: data.alerts.filter((a) => a.status === 'open').length, content: (
              <div data-tour="monitor-alerts" className="space-y-2">
                <Segmented label="Alert status" value={alertFilter} onChange={setAlertFilter} options={[{ value: 'open', label: 'Open' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'all', label: 'All' }]} />
                <DataTable caption="Detected alerts" rowKey={(a) => a.id} rows={pagedAlerts.rows} onRowClick={setDetail} empty={<p className="py-3 text-sm text-slate-500">No alerts recorded.</p>} columns={[
                  { key: 'level', label: 'Level', render: (a) => <StatusPill tone={LEVEL_TONE[a.level]}>{a.level}</StatusPill> },
                  { key: 'title', label: 'Alert', render: (a) => <span className="font-medium text-navy">{a.title}</span> },
                  { key: 'ships', label: 'Shipments', render: (a) => <span className="text-xs">{(a.shipmentRefs ?? []).join(', ') || '—'}</span> },
                  { key: 'at', label: 'Detected', render: (a) => <span className="text-xs whitespace-nowrap">{when(a.detectedAt)}</span> },
                  { key: 'status', label: 'Status', render: (a) => <Badge tone={a.status === 'open' ? 'amber' : 'slate'}>{a.status}</Badge> },
                ]} />
                <Pager paged={pagedAlerts} label="Alert pages" />
              </div>
            ) },
            { id: 'investigations', label: 'Investigations', count: data.investigations.length, content: (
              <BoundedList maxHeight="28rem" label="Monitoring investigations">
                <ul className="divide-y divide-slate-100">
                  {data.investigations.map((r) => (
                    <li key={r.id} className="py-2 text-sm">
                      <p className="flex flex-wrap items-center gap-2"><span className="font-medium text-navy">{r.task}</span><StatusPill tone={r.status === 'completed' ? 'emerald' : 'rose'}>{r.status}</StatusPill></p>
                      {r.summary && <p className="line-clamp-2 text-slate-600">{r.summary}</p>}
                      <Link to={`/app/agent?run=${encodeURIComponent(r.id)}`} className="text-xs font-semibold text-brand-800 hover:underline">Open in AI Agent Hub</Link>
                    </li>
                  ))}
                </ul>
                {!data.investigations.length && <p className="text-sm text-slate-500">No monitoring investigations yet.</p>}
              </BoundedList>
            ) },
            { id: 'tools', label: 'Tool history', count: data.toolHistory.length, content: (
              <div>
                <DataTable caption="Tool execution history" rowKey={(c) => c.id} rows={pagedTools.rows} empty={<p className="py-3 text-sm text-slate-500">No tool activity recorded.</p>} columns={[
                  { key: 'name', label: 'Tool', render: (c) => <span className="font-semibold text-navy">{c.name}</span> },
                  { key: 'status', label: 'Status', render: (c) => <StatusPill tone={c.status === 'ok' ? 'emerald' : 'rose'}>{c.status}</StatusPill> },
                  { key: 'summary', label: 'Summary', render: (c) => <span className="text-xs text-slate-600">{c.summary}</span> },
                  { key: 'ms', label: 'Duration', right: true, render: (c) => `${c.durationMs ?? 0} ms` },
                ]} />
                <Pager paged={pagedTools} label="Tool history pages" />
              </div>
            ) },
          ]} />
        </Card>
      </>}

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title ?? 'Alert'} subtitle={detail ? `${detail.level} · ${detail.status} · ${when(detail.detectedAt)}` : undefined}
        footer={detail && <>
          <Investigate task={`Investigate ${detail.title}`} />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => platform.setAlert(detail.id, detail.status === 'open' ? 'dismissed' : 'open')).then(() => setDetail(null))}>{detail.status === 'open' ? 'Dismiss alert' : 'Reopen alert'}</Button>
        </>}>
        {detail && (
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-slate-500">What was found</dt><dd className="text-slate-800">{detail.detail}</dd></div>
            <div><dt className="text-xs text-slate-500">Source</dt><dd>{detail.source}{detail.simulated ? ' (simulated)' : ''}</dd></div>
            {!!detail.shipmentRefs?.length && <div><dt className="text-xs text-slate-500">Shipments</dt><dd>{detail.shipmentRefs.join(', ')}</dd></div>}
            {detail.costImpactCad != null && <div><dt className="text-xs text-slate-500">Estimated cost impact</dt><dd>CAD {Math.round(detail.costImpactCad).toLocaleString()}{detail.overCostThreshold ? ' · over your threshold' : ''}</dd></div>}
            {detail.recommendation && <div><dt className="text-xs text-slate-500">Recommended</dt><dd className="font-medium text-navy">{detail.recommendation.title}</dd><dd className="text-slate-600">{detail.recommendation.detail}</dd></div>}
            {detail.runId && <Link to={`/app/agent?run=${encodeURIComponent(detail.runId)}`} className="inline-block text-sm font-semibold text-brand-800 underline">Open the investigation</Link>}
          </dl>
        )}
      </Drawer>
    </div>
  )
}
